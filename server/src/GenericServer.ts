import { Color, CompletionItem, ExecuteCommandParams, FormattingOptions, Position, PublishDiagnosticsParams, Range } from 'vscode-languageserver';
import { AvInitializeParams, IConnection } from './IConnection';
import { FilesManager } from './files/FilesManager';
import { FilesWatcher } from './files/FilesWatcher';
import { TemplateManager } from './language-services/json/TemplateManager';
import { ProjectManager } from './project/ProjectManager';
import { SettingsManager } from './settings/Settings';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { AventusExtension } from './definition';
import { ColorPicker } from './color-picker/ColorPicker';
import { Commands } from './cmds';
import { join } from 'path';


export class GenericServer {
	private static instance: GenericServer;

	public static delayBetweenBuild() {
		return this.instance.connection.delayBetweenBuild();
	}
	public static isDebug() {
		return this.instance.isDebug;
	}
	public static sendNotification(cmd: string, params: any) {
		this.instance.connection.sendNotification(cmd, params);
	}
	public static showErrorMessage(msg: string) {
		this.instance.connection.showErrorMessage(msg);
	}
	public static sendDiagnostics(params: PublishDiagnosticsParams) {
		this.instance.connection.sendDiagnostics(params);
	}
	public static getFsPath(): string {
		return this.instance._fsPath;
	}



	protected connection: IConnection;

	protected workspaces: string[] = [];
	protected isLoading: boolean = true;
	protected isDebug = false;
	private appData = process.env.APPDATA || (process.platform == 'darwin' ? process.env.HOME + '/Library/Preferences' : process.env.HOME + "/.local/share");
	private _fsPath: string = join(this.appData, "aventus");

	public constructor(connection: IConnection) {
		this.connection = connection;
		this.bindEvent();
	}

	public start() {
		GenericServer.instance = this;
		this.connection.open();
	}
	protected bindEvent() {
		this.connection.onInitialize((params: AvInitializeParams) => {
			this.onInitialize(params);
		})
		this.connection.onInitialized(async () => {
			this.onInitialized();
		})
		this.connection.onShutdown(async () => {
			await this.onShutdown();
		})
		this.connection.onCompletion(async (document, position) => {
			return await this.onCompletion(document, position);
		})
		this.connection.onCompletionResolve(async (document, completionItem) => {
			return await this.onCompletionResolve(document, completionItem);
		})
		this.connection.onHover(async (document, position) => {
			return await this.onHover(document, position);
		})
		this.connection.onDefinition(async (document, position) => {
			return await this.onDefinition(document, position);
		})
		this.connection.onDocumentFormatting(async (document, options) => {
			return await this.onDocumentFormatting(document, options);
		})
		this.connection.onCodeAction(async (document, range) => {
			return await this.onCodeAction(document, range);
		})
		this.connection.onCodeLens(async (document) => {
			return await this.onCodeLens(document);
		})
		this.connection.onReferences(async (document, position) => {
			return await this.onReferences(document, position);
		})
		this.connection.onRenameRequest(async (document, position, newName) => {
			return await this.onRenameRequest(document, position, newName);
		})
		this.connection.onDocumentColor(async (document) => {
			return await this.onDocumentColor(document);
		})
		this.connection.onColorPresentation(async (document, range, color) => {
			return await this.onColorPresentation(document, range, color);
		})
		this.connection.onExecuteCommand(async (params) => {
			return await this.onExecuteCommand(params);
		})
		this.connection.onDidChangeConfiguration(async () => {
			return await this.onDidChangeConfiguration();
		})
		this.connection.setFsPath((path: string) => {
			this._fsPath = path;
		})
	}

	protected onInitialize(params: AvInitializeParams) {
		if (params.workspaceFolders) {
			for (let workspaceFolder of params.workspaceFolders) {
				this.workspaces.push(workspaceFolder.uri);
			}
		}
	}
	protected async onInitialized() {
		await this.loadSettings();
		await this.startServer();
	}
	protected async onShutdown() {
		await FilesWatcher.getInstance().destroy();
		ProjectManager.getInstance().destroyAll();
		TemplateManager.getInstance().destroy();
		await FilesManager.getInstance().onShutdown();
	}
	protected async onCompletion(document: TextDocument | undefined, position: Position) {
		if (document && this.isAllowed(document)) {
			return await FilesManager.getInstance().onCompletion(document, position);
		}
		return null;
	}
	protected async onCompletionResolve(document: TextDocument | undefined, completionItem: CompletionItem) {
		if (document && this.isAllowed(document)) {
			return await FilesManager.getInstance().onCompletionResolve(document, completionItem);
		}
		return completionItem;
	}
	protected async onHover(document: TextDocument | undefined, position: Position) {
		if (document && this.isAllowed(document)) {
			return await FilesManager.getInstance().onHover(document, position);
		}
		return null;
	}
	protected async onDefinition(document: TextDocument | undefined, position: Position) {
		if (document && this.isAllowed(document)) {
			return await FilesManager.getInstance().onDefinition(document, position);
		}
		return null;
	}
	protected async onDocumentFormatting(document: TextDocument | undefined, options: FormattingOptions) {
		if (document && this.isAllowed(document)) {
			return await FilesManager.getInstance().onFormatting(document, options);
		}
		return null;
	}
	protected async onCodeAction(document: TextDocument | undefined, range: Range) {
		if (document && this.isAllowed(document)) {
			return await FilesManager.getInstance().onCodeAction(document, range);
		}
		return null;
	}
	protected async onCodeLens(document: TextDocument | undefined) {
		if (document && this.isAllowed(document)) {
			return await FilesManager.getInstance().onCodeLens(document);
		}
		return null;
	}
	protected async onReferences(document: TextDocument | undefined, position: Position) {
		if (document && this.isAllowed(document)) {
			return await FilesManager.getInstance().onReferences(document, position);
		}
		return null;
	}
	protected async onRenameRequest(document: TextDocument | undefined, position: Position, newName: string) {
		if (document && this.isAllowed(document)) {
			return await FilesManager.getInstance().onRename(document, position, newName);
		}
		return null;
	}
	protected async onDocumentColor(document: TextDocument | undefined) {
		if (document && this.isStyleDocument(document)) {
			return ColorPicker.onDocumentColor(document);
		}
		return null;
	}
	protected async onColorPresentation(document: TextDocument | undefined, range: Range, color: Color) {
		if (document && this.isStyleDocument(document)) {
			return ColorPicker.onColorPresentations(document, range, color);
		}
		return null;
	}
	protected async onExecuteCommand(params: ExecuteCommandParams) {
		return Commands.execute(params);
	}
	protected async onDidChangeConfiguration() {
		this.loadSettings();
	}


	protected isAllowed(document: TextDocument) {
		if (this.isLoading) {
			return false;
		}
		if (document.uri.endsWith(AventusExtension.Base) || document.uri.endsWith(AventusExtension.Config)) {
			return true;
		}
		return false;
	}
	protected isStyleDocument(document: TextDocument) {
		if (document.uri.endsWith(AventusExtension.ComponentStyle)) {
			return true;
		}
		if (document.uri.endsWith(AventusExtension.ComponentGlobalStyle)) {
			return true;
		}
		if (document.uri.endsWith(AventusExtension.GlobalStyle)) {
			return true;
		}
		return false;
	}
	protected async loadSettings() {
		let result = await this.connection.getSettings();
		if (!result) {
			result = {};
		}
		SettingsManager.getInstance().setSettings(result);
	}

	protected async startServer() {

		TemplateManager.getInstance();
		ProjectManager.getInstance();
		await FilesManager.getInstance().loadAllAventusFiles(this.workspaces);
		this.isLoading = false;
		if (this.isDebug) {
			console.log("start server done");
		}
	}

}