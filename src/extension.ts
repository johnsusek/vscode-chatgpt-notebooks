import * as vscode from 'vscode';
import { ChatGPTNotebookSerializer } from './ChatGPTNotebookSerializer';
import { ChatGPTController } from './ChatGPTController';

export function activate(context: vscode.ExtensionContext) {
  let hasBeenOpenedBefore = context.globalState.get('hasBeenOpenedBefore');

  if (!hasBeenOpenedBefore) {
    vscode.window.showInformationMessage('Welcome to the unofficial ChatGPT Notebooks extension! Use "Code" cells to enter your prompts; the execute cell function will send the conversation up to that point to the OpenAI API. You can choose your model in settings (default GPT-4).');
    context.globalState.update('hasBeenOpenedBefore', true);
  }

  let storedApiKey = context.globalState.get<string>('apiKey');

  if (!storedApiKey) promptForApiKey(context);

  context.subscriptions.push(new ChatGPTController(context));

  context.subscriptions.push(
    vscode.workspace.registerNotebookSerializer('chatgpt-notebook', new ChatGPTNotebookSerializer())
  );

  registerModelPicker(context);
}

function registerModelPicker(context: vscode.ExtensionContext) {
  let selectModelCmd = vscode.commands.registerCommand('chatgpt.selectModel', async () => {
    let activeEditor = vscode.window.activeNotebookEditor;
    if (!activeEditor) {
      vscode.window.showErrorMessage('No active notebook editor found.');
      return;
    }

    let selectedModel = await vscode.window.showQuickPick(['gpt-3.5-turbo', 'gpt-4'], {
      placeHolder: 'Select a GPT model',
    });

    if (selectedModel) {
      let config = vscode.workspace.getConfiguration('chatGPT');
      await config.update('selectedModel', selectedModel, vscode.ConfigurationTarget.Global);
    }
  });

  context.subscriptions.push(selectModelCmd);
}

async function promptForApiKey(context: vscode.ExtensionContext) {
  let apiKey = await vscode.window.showInputBox({
    placeHolder: 'Enter your OpenAI API Key',
    prompt: 'API Key is required to interact with ChatGPT',
    ignoreFocusOut: true
  });

  if (apiKey) {
    await context.globalState.update('apiKey', apiKey);
    vscode.window.showInformationMessage('API Key stored successfully.');
  } else {
    vscode.window.showErrorMessage('API Key is required for this extension to work.');
  }
}

