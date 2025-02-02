
export type LiveServerSettings = {
	host: string,
	autoIncrementPort: boolean
	port: number,
	rootFolder: string,
	indexFile: string,
	delay: number,
	launch_browser: boolean,
	browser: string,
	auto_close: boolean
}

export interface Settings {
	liveserver: LiveServerSettings,
	updateImportOnRename: boolean,
	projectPath: string[],
	templatePath: string[],
	useDefaultTemplate: boolean,
	readNodeModules: boolean,
	readDirs: string[],
	debug: boolean,
	// settings cli
	onlyBuild: boolean,
	useStats: boolean,
	/** The path of the aventus.conf.avt */
	configPath?: string,
	/** The builds to watch */
	builds?: string[],
	/** The statics to watch */
	statics?: string[],
	errorByBuild?: boolean
}

const defaultSettings: Settings = {
	liveserver: {
		host: "0.0.0.0",
		autoIncrementPort: true,
		port: 8080,
		rootFolder: "./dist",
		indexFile: "index.html",
		delay: 200,
		launch_browser: true,
		browser: "",
		auto_close: true,
	},
	updateImportOnRename: true,
	readNodeModules: false,
	templatePath: [],
	projectPath: [],
	readDirs: [],
	onlyBuild: false,
	debug: false,
	useStats: false,
	useDefaultTemplate: true,
}
function getDefaultSettings(): Settings {
	return JSON.parse(JSON.stringify(defaultSettings));
}

export class SettingsManager {
	private static instance: SettingsManager;

	private _settings: Settings = getDefaultSettings();

	public get settings() {
		return this._settings;
	}

	public static getInstance(): SettingsManager {
		if (!this.instance) {
			this.instance = new SettingsManager();
		}
		return this.instance;
	}

	private constructor() { }

	public setSettings(newSettings: Partial<Settings>) {
		this._settings = this.mergeDeep(getDefaultSettings(), newSettings);
		let cbs = [...this.cbOnSettingsChange];
		for (let cb of cbs) {
			cb();
		}
	}

	private cbOnSettingsChange: (() => void)[] = []
	public onSettingsChange(cb: () => void) {
		this.cbOnSettingsChange.push(cb);
	}

	private isObject(item) {
		return (item && typeof item === 'object' && !Array.isArray(item));
	}
	private mergeDeep(target, ...sources) {
		if (!sources.length) return target;
		const source = sources.shift();

		if (this.isObject(target) && this.isObject(source)) {
			for (const key in source) {
				if (this.isObject(source[key])) {
					if (!target[key]) Object.assign(target, { [key]: {} });
					this.mergeDeep(target[key], source[key]);
				} else {
					Object.assign(target, { [key]: source[key] });
				}
			}
		}

		return this.mergeDeep(target, ...sources);
	}
}