import { join, normalize, resolve, sep } from 'path';
import { Build, LocalCodeResult } from '../Build';
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { GenericServer } from '../../GenericServer';
import { EOL } from 'os';
import { getFolder, pathToUri, simplifyUri, uriToPath } from '../../tools';
import { mainTemplate } from './MainTemplate';
import { AventusConfigBuild } from '../../language-services/json/definition';
import { previewHeadTemplate } from './PreviewHead';
import { AventusTsFile } from '../../language-services/ts/File';
import { BaseInfo } from '../../language-services/ts/parser/BaseInfo';
import { defaultMdxTempate } from './DefaultMdxTemplate';
import { defaultStoryTempate, defaultStoryTempateComponent } from './DefaultStoryTemplate';
import { previewTemplate } from './PreviewTemplate';
import { EnumInfo } from '../../language-services/ts/parser/EnumInfo';
import { AventusWebComponentLogicalFile } from '../../language-services/ts/component/File';


export class Storie {

	public static getFullname(info: BaseInfo): string {
		let fullname = info.fullName.replace(/\./g, '/');
		let prefixFound = false;
		let config = info.build.buildConfig;
		const setPrefix = (prefix: string) => {
			if (prefix === "") {
			}
			else if (prefix.endsWith("/")) {
				fullname = prefix + fullname;
			}
			else {
				fullname = prefix + "/" + fullname;
			}
		}
		if (info.storieDecorator) {
			if (info.storieDecorator.fullName) {
				fullname = info.storieDecorator.fullName;
			}
			if (info.storieDecorator.prefix !== undefined) {
				prefixFound = true;
				setPrefix(info.storieDecorator.prefix);
			}
		}
		if (!prefixFound && config.stories?.prefix !== undefined) {
			setPrefix(config.stories.prefix);
		}
		return fullname;
	}

	private build: Build;
	private buildConfig: AventusConfigBuild;
	public constructor(build: Build, buildConfig: AventusConfigBuild) {
		this.build = build;
		this.buildConfig = buildConfig;

	}

	public async check() {
		this.readEnvStoryBook();
	}

	public write(files: { [uri: string]: AventusTsFile; }, clear: boolean = false) {
		if (clear) {
			this.clear();
		}
		for (let fileUri in files) {
			let currentFile = files[fileUri];
			if (!currentFile.fileParsed) continue;
			for (let name in currentFile.fileParsed.classes) {
				const _class = currentFile.fileParsed.classes[name];
				this.writeStory(_class, currentFile)
			}
			for (let name in currentFile.fileParsed.aliases) {
				const alias = currentFile.fileParsed.aliases[name];
				this.writeStory(alias)
			}
			for (let name in currentFile.fileParsed.enums) {
				const _enum = currentFile.fileParsed.enums[name];
				this.writeStory(_enum)
			}
			for (let name in currentFile.fileParsed.functions) {
				const _function = currentFile.fileParsed.functions[name];
				this.writeStory(_function)
			}
			for (let name in currentFile.fileParsed.variables) {
				const _var = currentFile.fileParsed.variables[name];
				this.writeStory(_var)
			}
		}
	}

	protected clear() {
		if (!this.buildConfig.stories) return;
		let outputPath = join(this.buildConfig.stories.output, "auto");
		//rmSync(outputPath, { recursive: true, force: true })
	}

	protected writeStory(info: BaseInfo, file?: AventusTsFile) {
		if (!info.storieContent) return;
		if (!this.buildConfig.stories) return;

		const storieContent = info.storieContent;
		let outputNpm = join(this.buildConfig.stories.output, "generated");
		let outputPath = join(this.buildConfig.stories.output, "auto", ...info.fullName.split("."));
		let outputPathDir = uriToPath(getFolder(pathToUri(outputPath)));
		if (!existsSync(outputPathDir)) {
			mkdirSync(outputPathDir, { recursive: true });
		}

		const writeMdx = () => {
			let template = defaultMdxTempate();
			template = this.replaceVariable(template, "name", info.name);
			let tag = `<av-story-${storieContent.kind}-render json={JSON.stringify(Meta.aventus)}></av-story-${storieContent.kind}-render>`
			template = this.replaceVariable(template, "tag", tag);

			if (file instanceof AventusWebComponentLogicalFile && file.fileParsed?.classes[file.componentClassName] && !file.fileParsed.classes[file.componentClassName].isAbstract) {
				template = this.replaceVariable(template, "live", `
<div>
    <Title>Live</Title>
    <Canvas />
    <Controls />
</div>`);
			}
			else {
				template = this.replaceVariable(template, "live", ``);
			}
			template = this.replaceVariable(template, "blocks", `import { Canvas, Controls, Title } from '@storybook/blocks'`);

			writeFileSync(outputPath + "_.mdx", template);
		}
		const writeStorie = () => {
			let template = file instanceof AventusWebComponentLogicalFile ? defaultStoryTempateComponent() : defaultStoryTempate();
			let name = info.name;
			let fullname = Storie.getFullname(info);
			let hasDefaultStory = true;
			if (info.storieDecorator) {
				if (info.storieDecorator.onlyMeta) {
					hasDefaultStory = false;
				}
			}
			template = this.replaceVariable(template, "name", name);
			template = this.replaceVariable(template, "fullname", fullname);
			template = this.replaceVariable(template, "description", info.documentation?.definitions.join("\n").replace(/`/g, '\\`') ?? '');
			template = this.replaceVariable(template, "aventus", "aventus: " + JSON.stringify(storieContent, null, 2) + ",");
			template = this.replaceVariable(template, "defaultStory", hasDefaultStory ? "export const DefaultStory: Story = {}" : "");
			if (file instanceof AventusWebComponentLogicalFile) {
				template = this.replaceVariable(template, "argTypes", "argTypes: " + JSON.stringify(file.storyBookInfo.argsTypes, null, 2) + ",");
				template = this.replaceVariable(template, "args", "args: " + JSON.stringify(file.storyBookInfo.args, null, 2) + ",");

				let importPathes: { [uri: string]: string[] } = file.fileParsed?.classes[file.componentClassName].storieInject ?? {};

				let fileNpm = join(outputNpm, ...storieContent.namespace!.split("."));
				let importPath = simplifyUri(pathToUri(fileNpm), pathToUri(outputPath));
				if (!importPathes[importPath]) {
					importPathes[importPath] = [name];
				}
				else {
					if (!importPathes[importPath].includes(name)) {
						importPathes[importPath].push(name);
					}
				}

				const importTxt: string[] = [];
				for (let _path in importPathes) {
					importTxt.push(`import { ${importPathes[_path].join(", ")} } from '${_path}';`)
				}
				template = this.replaceVariable(template, "importPathes", importTxt.join("\n"));
			}

			writeFileSync(outputPath + ".stories.ts", template);
		}

		writeMdx();
		writeStorie();
	}

	public readEnvStoryBook() {
		if (!this.buildConfig.stories) return;

		if (!existsSync(this.buildConfig.stories.output)) {
			mkdirSync(this.buildConfig.stories.output, { recursive: true });
		}
		const path = this.buildConfig.stories.output;
		const currentVars: { [name: string]: string } = {
			"name": ("@" + this.buildConfig.module + "/" + this.buildConfig.name + "_storybook").toLowerCase(),
			"displayName": this.buildConfig.module + " " + this.buildConfig.name + "_storybook",
			"description": "Aventus storybook for " + "@" + this.buildConfig.module + "/" + this.buildConfig.name,
			"version": this.buildConfig.version,
		};
		if (readdirSync(this.buildConfig.stories.output).length == 0) {
			let projectsFolder = GenericServer.extensionPath + sep + "templates" + sep + "storybook";
			let folders = readdirSync(projectsFolder);
			let folderPath: string = "";

			const _internalLoop = (currentPath) => {
				let files = readdirSync(currentPath);
				for (let file of files) {
					let templatePath = currentPath + sep + file;
					let exportPath = templatePath.replace(folderPath, path);
					for (let varName in currentVars) {
						const regex = new RegExp('\\$\\{\\{' + varName + '\\}\\}', 'gm');
						exportPath = exportPath.replace(regex, currentVars[varName]);
					}
					exportPath = normalize(exportPath);
					if (statSync(templatePath).isDirectory()) {
						if (file == '.git') continue;
						mkdirSync(exportPath);
						_internalLoop(templatePath);
					}
					else {
						if ((/\.(gif|jpe?g|tiff?|png|webp|bmp)$/i).test(templatePath.toLowerCase())) {
							copyFileSync(templatePath, exportPath);
						}
						else {
							let ctx = readFileSync(templatePath, 'utf-8');
							for (let varName in currentVars) {
								const regex = new RegExp('\\$\\{\\{' + varName + '\\}\\}', 'gm');
								ctx = ctx.replace(regex, currentVars[varName]);
							}
							if (file == "package.json") {
								let packageJson = JSON.parse(ctx);
								if (!packageJson.devDependencies) {
									packageJson.devDependencies = {};
								}
								for (let uri of this.build.externalPackageInformation.filesUri) {
									let file = this.build.externalPackageInformation.getByUri(uri);
									if (!file) continue;
									if (!file.npmUri) continue;
									// avoid add self dependance
									if (file.name == this.buildConfig.fullname) continue
									packageJson.devDependencies[file.npmUri] = '^' + file.versionTxt;
								}

								const devDependencies = Object.keys(packageJson.devDependencies).sort().reduce(
									(obj, key) => {
										obj[key] = packageJson.devDependencies[key];
										return obj;
									},
									{}
								);
								packageJson.devDependencies = devDependencies;
								ctx = JSON.stringify(packageJson, null, 4);
							}
							writeFileSync(exportPath, ctx);
						}


					}
				}
			}

			if (folders.length == 1) {
				folderPath = projectsFolder + sep + folders[0];
				// cpSync(, this.buildConfig.stories.output, { force: true, recursive: true })
			}
			else {
				throw 'TODO code multiple template'
			}
			_internalLoop(folderPath);

		}

		const workspace = this.buildConfig.stories.workspace ? resolve(this.build.project.getConfigFile().folderPath, this.buildConfig.stories.workspace) : path;
		const storyPath = join(workspace, ".storybook");
		if (!existsSync(storyPath)) {
			mkdirSync(storyPath, { recursive: true });
		}



		const mainTsPath = join(storyPath, "main.ts");
		if (!existsSync(mainTsPath)) {
			let template = mainTemplate();
			let uri = simplifyUri(pathToUri(this.buildConfig.stories.output), pathToUri(mainTsPath));
			template = this.replaceVariable(template, "path", uri);
			writeFileSync(mainTsPath, template);
		}

		const previewHeadPath = join(storyPath, "preview-head.html");
		if (!existsSync(previewHeadPath)) {
			let template = previewHeadTemplate();
			writeFileSync(previewHeadPath, template);
		}

		const previewPath = join(storyPath, "preview.ts");
		if (!existsSync(previewPath)) {
			let template = previewTemplate();
			writeFileSync(previewPath, template);
		}
	}


	protected replaceVariable(src: string, variable: string, replace: string) {
		let regex = new RegExp("\\$" + variable + "\\$", "g");
		src = src.replace(regex, replace);
		return src;
	}
}