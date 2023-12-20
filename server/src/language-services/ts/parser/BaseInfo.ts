import { Node, CallExpression, ClassDeclaration, EnumDeclaration, FunctionDeclaration, InterfaceDeclaration, SyntaxKind, TypeAliasDeclaration, TypeNode, TypeReferenceNode, forEachChild, ExpressionWithTypeArguments, NewExpression, PropertyAccessExpression, VariableStatement, VariableDeclaration, MethodDeclaration } from "typescript";
import { ParserTs } from './ParserTs';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { BaseLibInfo } from './BaseLibInfo';
import { TypeInfo } from './TypeInfo';
import { DecoratorInfo } from './DecoratorInfo';
import { DependancesDecorator } from './decorators/DependancesDecorator';
import * as md5 from 'md5';
import { GenericServer } from '../../../GenericServer';


export enum InfoType {
    none,
    class,
    classData,
    interface,
    function,
    variable,
    enum
}

export type SupportedRootNodes = ClassDeclaration | EnumDeclaration | InterfaceDeclaration | TypeAliasDeclaration | FunctionDeclaration | VariableDeclaration | MethodDeclaration

export abstract class BaseInfo {
    private static infoByShortName: { [shortName: string]: BaseInfo } = {};
    private static infoByFullName: { [shortName: string]: BaseInfo } = {};
    public static getInfoByShortName(shortName: string): BaseInfo | undefined {
        return this.infoByShortName[shortName];
    }
    public static getInfoByFullName(fullName: string, from: BaseInfo): BaseInfo | undefined {
        let result = this.infoByFullName[fullName];
        if (!result) {
            result = this.infoByFullName[from.fullName.split('.')[0] + "." + fullName];
        }
        return result
    }

    public static isExported(node: ClassDeclaration | EnumDeclaration | InterfaceDeclaration | TypeAliasDeclaration | FunctionDeclaration | VariableStatement | MethodDeclaration) {
        if (node.modifiers) {
            for (let modifier of node.modifiers) {
                if (modifier.kind == SyntaxKind.ExportKeyword) {
                    return true;
                }
            }
        }
        return false;
    }

    public name: string = "";
    public nameStart: number = 0;
    public nameEnd: number = 0;
    public start: number = 0;
    public end: number = 0;
    public fullName: string = "";
    public namespace: string = "";
    public decorators: DecoratorInfo[] = [];

    // public dependancesFullName: string[] = [];
    public dependances: {
        fullName: string,
        uri: string, // @local (same file), @external (lib), @npm (npm), file uri (same build) 
        isStrong: boolean,
    }[] = []
    public compiled: string = "";
    public documentation: string[] = [];
    public isExported: boolean = false;
    private _parserInfo: ParserTs;
    public content: string = "";
    public get compiledContent(): string {
        let txt = this.content;
        let transformations: { newText: string, start: number, end: number }[] = [];
        for (let depName in this.dependancesLocations) {
            let replacement = this.dependancesLocations[depName].replacement;
            if (replacement) {
                for (let locationKey in this.dependancesLocations[depName].locations) {
                    let location = this.dependancesLocations[depName].locations[locationKey];
                    transformations.push({
                        newText: replacement,
                        start: location.start - this.start,
                        end: location.end - this.start,
                    })
                }
            }
        }
        transformations.sort((a, b) => b.end - a.end); // order from end file to start file
        for (let transformation of transformations) {
            txt = txt.slice(0, transformation.start) + transformation.newText + txt.slice(transformation.end, txt.length);
        }
        return txt;
    }
    public get fileUri() {
        return this.document.uri;
    }
    public debug: boolean = false;
    public document: TextDocument;
    private dependanceNameLoaded: string[] = [];
    private dependancePrevented: string[] = [];
    public dependancesLocations: {
        [name: string]: {
            replacement: string | null,
            locations: { [key: string]: { start: number, end: number } }
        }
    } = {};
    public infoType: InfoType = InfoType.none;

    public get parserInfo() {
        return this._parserInfo;
    }

    constructor(node: SupportedRootNodes, namespaces: string[], parserInfo: ParserTs, autoLoadDepDecorator: boolean = true) {
        this._parserInfo = parserInfo;
        this.document = parserInfo.document;
        this.decorators = DecoratorInfo.buildDecorator(node, this);
        this.dependancesLocations = {};
        if (node.name) {
            this.start = node.getStart();
            this.end = node.getEnd();
            this.name = node.name.getText();
            this.nameStart = node.name.getStart();
            this.nameEnd = node.name.getEnd();
            this.namespace = namespaces.join(".");
            this.fullName = [...namespaces, this.name].join(".");
            this.content = node.getText();

            if (!parserInfo.isLib) {
                BaseInfo.infoByShortName[this.name] = this;
            }
            if (node['jsDoc']) {
                for (let jsDoc of node['jsDoc']) {
                    this.documentation.push(jsDoc.comment);
                }
            }
            if (node.kind != SyntaxKind.VariableDeclaration) {
                this.isExported = BaseInfo.isExported(node);
            }
            BaseInfo.infoByFullName[this.fullName] = this;
        }

        if (autoLoadDepDecorator) {
            this.loadDependancesDecorator();
        }

    }

    protected loadDependancesDecorator() {
        for (let decorator of this.decorators) {
            let temp = DependancesDecorator.is(decorator);
            if (temp) {
                for (let dependance of temp.dependances) {
                    this.addDependanceName(dependance.type, dependance.strong, 0, 0);
                }
            }
        }
    }

    protected preventDependanceAdd(name: string) {
        if (!this.dependancePrevented.includes(name)) {
            this.dependancePrevented.push(name);
        }
    }

    private loadExpression(x: Node, depth2: number = 0, isStrongDependance: boolean = false) {
        if (this.debug) {
            console.log("***" + depth2 + ". " + x.getText());
            console.log(SyntaxKind[x.kind]);
        }
        if (x.kind == SyntaxKind.ExpressionWithTypeArguments) {
            this.addDependance(x as ExpressionWithTypeArguments, isStrongDependance);
        }
        else if (x.kind == SyntaxKind.NewExpression) {
            let exp = (x as NewExpression);
            this.loadExpression(exp.expression, depth2 + 1, isStrongDependance);
        }
        else if (x.kind == SyntaxKind.PropertyAccessExpression) {
            let exp = (x as PropertyAccessExpression);
            let txt = exp.name.getText();
            let baseInfo = ParserTs.getBaseInfo(txt);
            if (baseInfo) {
                // when static call on external class
                if (exp.expression.getText() + "." + txt == baseInfo.fullName) {
                    this.addDependanceName(baseInfo.fullName, isStrongDependance, exp.expression.getStart(), exp.expression.getEnd());
                }
            }
            else {
                // when static call on local class
                let localClassName = exp.expression.getText();
                if (localClassName != 'this' && !localClassName.includes('.')) {
                    if (ParserTs.hasLocal(localClassName)) {
                        this.addDependanceName(localClassName, isStrongDependance, exp.expression.getStart(), exp.expression.getEnd());
                    }
                    else if (ParserTs.hasImport(localClassName)) {
                        this.addDependanceName(localClassName, isStrongDependance, exp.expression.getStart(), exp.expression.getEnd());
                    }
                }
            }
            this.loadExpression(exp.expression, depth2 + 1, isStrongDependance);
        }
        else if (x.kind == SyntaxKind.Identifier) {
            if (x.parent.kind == SyntaxKind.PropertyAccessExpression) {
                return;
            }
            else if (x.parent.kind >= SyntaxKind.VariableDeclaration && x.parent.kind <= SyntaxKind.JsxExpression) {
                return;
            }
            let localClassName = x.getText();
            if (localClassName != 'this' && !localClassName.includes('.')) {
                let baseInfo = ParserTs.getBaseInfo(localClassName);
                if (baseInfo) {
                    this.addDependanceName(localClassName, isStrongDependance, x.getStart(), x.getEnd());
                }
                else {
                    if (ParserTs.hasLocal(localClassName)) {
                        this.addDependanceName(localClassName, isStrongDependance, x.getStart(), x.getEnd());
                    }
                    else if (ParserTs.hasImport(localClassName)) {
                        this.addDependanceName(localClassName, isStrongDependance, x.getStart(), x.getEnd());
                    }
                }
            }
        }
        else if (x.kind == SyntaxKind.CallExpression) {
            let exp = (x as CallExpression);
            this.loadExpression(exp.expression, depth2 + 1, isStrongDependance);
        }
    }
    protected loadOnlyDependancesRecu(node: Node, depth: number = 0, isStrongDependance: boolean = false) {
        if (this.parserInfo.isLib) {
            return
        }
        forEachChild(node, x => {
            if (x.kind == SyntaxKind.TypeReference) {
                this.addDependance(x as TypeReferenceNode, isStrongDependance);
                return;
            }
            else {
                this.loadExpression(x, depth, isStrongDependance);
            }


            this.loadOnlyDependancesRecu(x, depth + 1, isStrongDependance);
        })
    }
    /**
     * return the fullName
     * @param name 
     * @param isStrongDependance 
     */
    protected addDependance(type: TypeNode, isStrongDependance: boolean): string[] {
        // TODO : add scope declaration variable
        let result: string[] = [];
        const loop = (info: TypeInfo) => {
            if (info.kind == "type") {
                let fullName = this.addDependanceName(info.value, isStrongDependance, info.start, info.endNonGeneric);
                if (fullName !== null) {
                    result.push(fullName);
                }
                for (let nested of info.nested) {
                    loop(nested);
                }
                for (let generic of info.genericValue) {
                    loop(generic);
                }
            }
            else if (info.kind == "typeLiteral" || info.kind == "function") {
                for (let nested of info.nested) {
                    loop(nested);
                }
            }

            else if (info.kind == "union") {
                for (let nested of info.nested) {
                    loop(nested);
                }
            }
        }
        loop(new TypeInfo(type));


        return result;
    }
    protected addDependanceName(name: string, isStrongDependance: boolean, start: number, end: number): string | null {
        if (!name || name == "constructor" || name == "toString") {
            return null
        }
        if (this.debug) {
            console.log("try add dependance " + name);
        }
        let match = /<.*>/g.exec(name);
        if (match) {
            end -= match[0].length;
            name = name.replace(match[0], '');
        }
        // if same class
        if (name == this.fullName) {
            return null;
        }
        // if its come from js native
        if (BaseLibInfo.exists(name)) {
            return null;
        }

        if (start > 0 && end > 0) {
            if (!this.dependancesLocations[name]) {
                this.dependancesLocations[name] = {
                    locations: {},
                    replacement: null
                }
            }
            let key = start + "_" + end;
            if (!this.dependancesLocations[name].locations) {
                GenericServer.showErrorMessage("For the admin : you can add " + name + " as dependance to avoid");
                return null;
            }
            if (!this.dependancesLocations[name].locations[key]) {
                this.dependancesLocations[name].locations[key] = {
                    start: start,
                    end: end
                };
            }
        }


        if (!this.addDependanceNameCustomCheck(name)) {
            return null;
        }
        if (this.dependancePrevented.includes(name)) {
            return null;
        }
        if (this.dependanceNameLoaded.includes(name)) {
            return null;
        }
        this.dependanceNameLoaded.push(name);

        if (name.includes(".")) {
            // lib name => impossible to be a local name
            this.dependances.push({
                fullName: name,
                uri: "@external",
                isStrong: isStrongDependance
            });
            return name;
        }
        if (this.parserInfo.internalObjects[name]) {
            let fullName = this.parserInfo.internalObjects[name].fullname
            if(fullName == this.fullName) {
                isStrongDependance = false;
            }
            this.dependances.push({
                fullName: "$namespace$" + fullName,
                uri: '@local',
                isStrong: isStrongDependance
            });
            if (this.debug) {
                console.log("add dependance " + name + " : same file");
            }
            if (this.dependancesLocations[name])
                this.dependancesLocations[name].replacement = fullName;
            return fullName;
        }

        if (this.parserInfo.imports[name]) {
            // it's an imported class
            let fullName = this.parserInfo.imports[name].fullName
            this.dependances.push({
                fullName: "$namespace$" + fullName,
                uri: this.parserInfo.imports[name].fileUri,
                isStrong: isStrongDependance
            });
            if (this.debug) {
                console.log("add dependance " + name + " : imported file");
            }
            if (this.dependancesLocations[name])
                this.dependancesLocations[name].replacement = fullName;
            return fullName;
        }
        else if (this.parserInfo.waitingImports[name]) {
            // TODO maybe return a specific value to parsed after file is ready
            if (this.debug) {
                console.log("add dependance " + name + " : but waiting import file");
            }
            this.parserInfo.waitingImports[name].push((info) => {
                let fullName = this.parserInfo.imports[name].fullName
                if (this.dependancesLocations[name])
                    this.dependancesLocations[name].replacement = fullName;
            })
        }

        if (this.parserInfo.npmImports[name]) {
            this.dependances.push({
                fullName: name,
                uri: "@npm",
                isStrong: isStrongDependance
            });
            if (this.debug) {
                console.log("add dependance " + name + " : npm");
            }
            if (this.dependancesLocations[name]) {
                let md5uri = md5(this.parserInfo.npmImports[name].uri);
                this.dependancesLocations[name].replacement = "npmCompilation['" + md5uri + "']." + name;
            }
            return name;
        }
        // should be a lib dependances outside the module
        this.dependances.push({
            fullName: name,
            uri: "@external",
            isStrong: isStrongDependance
        });
        if (this.debug) {
            console.log("add dependance " + name + " : external");
        }
        return name;
    }

    protected addDependanceNameCustomCheck(name: string): boolean {
        return true;
    }


}