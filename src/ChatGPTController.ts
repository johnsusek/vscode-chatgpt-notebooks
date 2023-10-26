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
  private apiKey: string;
  private characterThreshold: number;

  constructor(context: vscode.ExtensionContext, storedApiKey?: string) {
    this.context = context;
    this.apiKey = storedApiKey;

    this.characterThreshold = vscode.workspace.getConfiguration('chatGPT').get('characterThreshold', 1000);

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
    this.checkWordThreshold();
  }

  private async promptForApiKey() {
    let apiKey = await vscode.window.showInputBox({
      placeHolder: 'Enter your OpenAI API Key',
      prompt: 'API Key is required to interact with ChatGPT',
      ignoreFocusOut: true
    });

    if (apiKey) {
      await this.context.globalState.update('apiKey', apiKey);
      vscode.window.showInformationMessage('API Key stored successfully.');
    } else {
      vscode.window.showErrorMessage('API Key is required for this extension to work.');
    }
  }

  private getText(raw: Uint8Array) {
    return (new TextDecoder().decode(raw));
  }

  private async executeCell(cell: vscode.NotebookCell, notebook: vscode.NotebookDocument): Promise<void> {
    let execution = this.controller.createNotebookCellExecution(cell);
    execution.start(Date.now());

    let model = vscode.workspace.getConfiguration('chatGPT').get('selectedModel', 'gpt-4');
    let apiKey = this.apiKey || this.context.globalState.get<string>('apiKey');

    if (!apiKey) {
      await this.promptForApiKey();
      apiKey = this.context.globalState.get<string>('apiKey');
      if (!apiKey) {
        vscode.window.showErrorMessage('API key not set. Please set your API key.');
        execution.end(false, Date.now());
        return;
      }
      this.apiKey = apiKey;
    }

    let cellIndex = notebook.getCells().indexOf(cell);
    let cells = notebook.getCells();
    let conversationHistory = [];

    for (let idx = 0; idx <= cellIndex; idx++) {
      let cell = cells[idx];
      let resp = cell.outputs.map(o => o.items.map(item => this.getText(item.data)).join('')).join('');

      conversationHistory.push({
        role: 'user',
        content: cell.document.getText()
      })

      if (idx !== cellIndex) {
        // Don't sent the response to the last cell (overwrite it)
        conversationHistory.push({
          role: 'assistant',
          content: resp
        })
      }
    }

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

  private checkWordThreshold() {
    let activeEditor = vscode.window.activeNotebookEditor;
    if (!activeEditor) return;

    let notebook = activeEditor.notebook;
    let totalWords = 0;

    for (let cell of notebook.getCells()) {
      totalWords += cell.document.getText().length;

      for (let output of cell.outputs) {
        for (let item of output.items) {
          if (item.mime === 'text/plain' || item.mime === 'text/markdown') {
            totalWords += this.getText(item.data).length;
          }
        }
      }
    }

    if (totalWords > this.characterThreshold) {
      vscode.window.showWarningMessage(`Notebook over ${this.characterThreshold} characters may result in poor results and large requests. Consider starting a new conversation.`);
    }
  }
}
