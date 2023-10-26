import * as vscode from 'vscode';

export class ChatGPTController implements vscode.Disposable {
  readonly controllerId = 'chatgpt-controller';
  readonly notebookType = 'chatgpt-notebook';
  readonly label = 'ChatGPT';
  readonly supportedLanguages = ['markdown'];
  private readonly context: vscode.ExtensionContext;
  private readonly controller: vscode.NotebookController;
  private shouldAbort = false;
  private autoSave: boolean;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;

    this.controller = vscode.notebooks.createNotebookController(
      this.controllerId,
      this.notebookType,
      this.label
    );

    this.autoSave = vscode.workspace.getConfiguration('chatGPT').get('autoSave', true);

    this.controller.supportedLanguages = this.supportedLanguages;
    this.controller.supportsExecutionOrder = false;
    this.controller.executeHandler = this.execute.bind(this);
    this.controller.interruptHandler = this.interrupt.bind(this);
  }

  private interrupt() {
    this.shouldAbort = true;
  }

  dispose() {
    this.controller.dispose();
  }

  private execute(
    cells: vscode.NotebookCell[],
    notebook: vscode.NotebookDocument
  ) {
    for (let cell of cells) {
      this.executeCell(cell, notebook);
    }
  }

  private async executeCell(cell: vscode.NotebookCell, notebook: vscode.NotebookDocument): Promise<void> {
    let execution = this.controller.createNotebookCellExecution(cell);
    execution.start(Date.now());

    let model = vscode.workspace.getConfiguration('chatGPT').get('selectedModel', 'gpt-4');
    let apiKey = this.context.globalState.get<string>('apiKey');

    if (!apiKey) {
      vscode.window.showErrorMessage('API key not set. Please set your API key.');
      execution.end(false, Date.now());
      return;
    }

    let cellIndex = notebook.getCells().indexOf(cell);

    let conversationHistory = notebook.getCells().slice(0, cellIndex + 1).map(c => ({
      role: c.kind === vscode.NotebookCellKind.Code ? 'user' : 'assistant',
      content: c.document.getText()
    }));

    let partialOutput = '';
    let abortController = new AbortController();

    try {
      let response = await fetch(`https://api.openai.com/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: model,
          messages: conversationHistory,
          stream: true
        }),
        signal: abortController.signal
      });

      if (!response.body) {
        console.error('No response body');
        execution.end(false, Date.now());
        return;
      }

      let reader = response.body.getReader();
      let decoder = new TextDecoder("utf-8");

      while (true) {
        if (this.shouldAbort) abortController.abort();
        let { done, value } = await reader.read();
        if (done) {
          break;
        }

        let chunk = decoder.decode(value).trim();
        let lines = chunk.split("\n\n");
        lines = lines.map(l => l.slice(6));
        lines = lines.filter(l => l !== '[DONE]');

        let parsedLines = lines.map(l => JSON.parse(l));

        for (let parsedLine of parsedLines) {
          let { choices } = parsedLine;
          let { delta } = choices[0];
          let { content } = delta;

          if (content) {
            partialOutput += content;

            execution.replaceOutput([
              new vscode.NotebookCellOutput([
                vscode.NotebookCellOutputItem.text(partialOutput, 'text/markdown')
              ])
            ]);
          }
        }
      }

      execution.end(true, Date.now());

      if (this.autoSave) await vscode.workspace.saveAll();
    } catch (error) {
      if (error.name === 'AbortError') {
        if (this.autoSave) await vscode.workspace.saveAll();
        execution.end(true, Date.now());
      }
      else if (error.response?.data?.error?.message) {
        vscode.window.showErrorMessage(error.response?.data.error.message);
      }
      else {
        vscode.window.showErrorMessage('Error communicating with ChatGPT: ' + error.message);
      }

      execution.end(false, Date.now());
    }
  }
}
