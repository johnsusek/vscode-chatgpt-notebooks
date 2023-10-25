import { TextDecoder, TextEncoder } from 'util';
import * as vscode from 'vscode';

interface RawNotebook {
  cells: RawNotebookCell[];
}

interface RawNotebookCell {
  source: string[];
  outputs?: string[];
}

export class ChatGPTNotebookSerializer implements vscode.NotebookSerializer {
  async deserializeNotebook(content: Uint8Array): Promise<vscode.NotebookData> {
    let contents = new TextDecoder().decode(content);
    let raw: RawNotebook;

    try {
      raw = JSON.parse(contents);
    } catch (e) {
      if (contents.length) {
        vscode.window.showErrorMessage('Error parsing notebook content: ' + e.message);
      }
      return new vscode.NotebookData([]);
    }

    let cells = raw.cells.map(item => {
      let cellData = new vscode.NotebookCellData(
        vscode.NotebookCellKind.Code,
        item.source.join('\n'),
        'markdown'
      );

      if (item.outputs) {
        cellData.outputs = [
          new vscode.NotebookCellOutput([
            vscode.NotebookCellOutputItem.text(item.outputs.join('\n'), 'text/markdown')
          ])
        ];
      }

      return cellData;
    }
    );

    let data = new vscode.NotebookData(cells);

    return data;
  }

  async serializeNotebook(data: vscode.NotebookData): Promise<Uint8Array> {
    let cells: RawNotebookCell[] = data.cells.map(cell => {
      let outputs = cell.outputs.length > 0 ? cell.outputs[0].items.map(item => new TextDecoder().decode(item.data)) : [];

      return {
        cellType: cell.kind === vscode.NotebookCellKind.Code ? 'prompt' : 'response',
        source: cell.value.split(/\r?\n/g),
        outputs: outputs
      };
    });

    let notebookData: RawNotebook = { cells };

    return new TextEncoder().encode(JSON.stringify(notebookData));
  }
}
