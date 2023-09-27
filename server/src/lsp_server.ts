
import * as lsp from 'vscode-languageserver';
import { URI } from 'vscode-uri';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { TokenType, TokenErrorType } from "./asm/tokenizer"
import { LabelScanner } from "./asm/labels";
import * as asm from "./asm/assembler";
import * as stm from "./asm/x_statements";
import * as fs from 'fs';
import { SymbolType } from "./asm/symbols";

//------------------------------------------------------------------------------

// indexes used to map from TokenTypes to semantic tokens
// NOTE: if this changes, semanticTokensProvider.tokenTypes must also change
// TODO: find a better way to build it all as one table (maybe a map?)

export enum SemanticToken {
  invalid   = 0,
  comment   = 1,
  string    = 2,
  number    = 3,
  operator  = 4,
  keyword   = 5,
  label     = 6,
  macro     = 7,

  opcode    = 8,
  constant  = 9,
  zpage     = 10,
  var       = 11
}

export enum SemanticModifier {
  local     = 0,
  global    = 1,
  external  = 2,
  unused    = 3
}

//------------------------------------------------------------------------------

export function pathFromUriString(stringUri: string): string | undefined {
  const uri = URI.parse(stringUri);
  if (uri.scheme == 'file') {
    const fsPath = URI.file(uri.fsPath).fsPath;
    const RE_PATHSEP_WINDOWS = /\\/g;
    return fsPath.replace(RE_PATHSEP_WINDOWS, '/');
  }
}

//------------------------------------------------------------------------------

// *** still needed? ***

export class LspDocument implements TextDocument {
  protected document: TextDocument;

  constructor(doc: lsp.TextDocumentItem) {
    const { uri, languageId, version, text } = doc;
    this.document = TextDocument.create(uri, languageId, version, text);
  }

  get uri(): string {
    return this.document.uri;
  }

  get languageId(): string {
    return this.document.languageId;
  }

  get version(): number {
    return this.document.version;
  }

  getText(range?: lsp.Range): string {
    return this.document.getText(range);
  }

  positionAt(offset: number): lsp.Position {
    return this.document.positionAt(offset);
  }

  offsetAt(position: lsp.Position): number {
    return this.document.offsetAt(position);
  }

  get lineCount(): number {
    return this.document.lineCount;
  }

  getLine(line: number): string {
    const lineRange = this.getLineRange(line);
    return this.getText(lineRange);
  }

  getLineRange(line: number): lsp.Range {
    const lineStart = this.getLineStart(line);
    const lineEnd = this.getLineEnd(line);
    return lsp.Range.create(lineStart, lineEnd);
  }

  getLineEnd(line: number): lsp.Position {
    const nextLine = line + 1;
    const nextLineOffset = this.getLineOffset(nextLine);
    // If next line doesn't exist then the offset is at the line end already.
    return this.positionAt(nextLine < this.document.lineCount ? nextLineOffset - 1 : nextLineOffset);
  }

  getLineStart(line: number): lsp.Position {
    return lsp.Position.create(line, 0);
  }

  getLineOffset(line: number): number {
    const lineStart = this.getLineStart(line);
    return this.offsetAt(lineStart);
  }

  applyEdit(version: number, change: lsp.TextDocumentContentChangeEvent): void {
    const content = this.getText();
    let newContent = change.text;
    if (lsp.TextDocumentContentChangeEvent.isIncremental(change)) {
        const start = this.offsetAt(change.range.start);
        const end = this.offsetAt(change.range.end);
        newContent = content.substr(0, start) + change.text + content.substr(end);
    }
    // NOTE: this seems excessive but the TypeScript lsp-server does it too
    this.document = TextDocument.create(this.uri, this.languageId, version, newContent);
  }
}

//------------------------------------------------------------------------------

// *** still needed? ***

export class LspDocuments {
  private readonly documents = new Map<string, LspDocument>();

  get(file: string): LspDocument | undefined {
    return this.documents.get(file);
  }

  open(file: string, doc: lsp.TextDocumentItem): boolean {
    if (this.documents.has(file)) {
        return false;
    }
    this.documents.set(file, new LspDocument(doc));
    return true;
  }

  close(file: string): LspDocument | undefined {
      const document = this.documents.get(file);
      if (!document) {
          return undefined;
      }
      this.documents.delete(file);
      return document;
  }
}

//------------------------------------------------------------------------------

// *** fold some of this into asm.Project ***

class LspProject extends asm.Project {

  private server: LspServer
  public temporary: boolean

  constructor(server: LspServer, rootDir: string, temporary = false) {
    super(rootDir)
    this.server = server
    this.temporary = temporary
  }

  getFileContents(path: string): string | undefined {
    // look through open documents first
    const document = this.server.documents.get(path)
    if (document) {
      return document.getText()
    }
    // if no open document, got look in file system
    return super.getFileContents(path)
  }

  // updateDiagnostics() {
  //   this.modules.forEach(module => {
  //     module.sourceFiles.forEach(sourceFile => {
  //       this.server.updateDiagnostics(sourceFile)
  //     })
  //   })
  // }
}

//------------------------------------------------------------------------------

//*** think about factoring this so some of the code could be used in SublimeText, for example

export class LspServer {

  private connection: lsp.Connection
  public documents = new LspDocuments()
  private projects: LspProject[] = []
  public workspaceFolderPath = ""

  constructor(connection: lsp.Connection) {
    this.connection = connection;

	  // TODO: switch to an override once server.ts cleaned up
    // connection.onInitialize(this.onInitialize.bind(this));

    connection.onDidOpenTextDocument(this.onDidOpenTextDocument.bind(this))
    connection.onDidCloseTextDocument(this.onDidCloseTextDocument.bind(this))
    connection.onDidChangeTextDocument(this.onDidChangeTextDocument.bind(this))

    connection.onCompletion(this.onCompletion.bind(this))
    connection.onCompletionResolve(this.onCompletionResolve.bind(this))
    connection.onDefinition(this.onDefinition.bind(this))
    connection.onExecuteCommand(this.onExecuteCommand.bind(this))
    connection.onFoldingRanges(this.onFoldingRanges.bind(this))
    connection.onHover(this.onHover.bind(this))
    connection.onReferences(this.onReferences.bind(this))
    connection.languages.semanticTokens.on(this.onSemanticTokensFull.bind(this))
    connection.languages.semanticTokens.onRange(this.onSemanticTokensRange.bind(this))
  }

  private findSourceFile(filePath: string): asm.SourceFile | undefined {
    for (let i = 0; i < this.projects.length; i += 1) {
      const sourceFile = this.projects[i].findSourceFile(filePath)
      if (sourceFile) {
        return sourceFile
      }
    }
  }

  onInitialize(params: lsp.InitializeParams): void {

    const n = 1;
    while (n) {
      console.log();  // ***
    }

    if (params.workspaceFolders) {
      // *** walk each folder -- or don't support multiple folders ***
      const workspaceFolder = params.workspaceFolders[0];
      // move to this.workspaceFolderPath
      this.workspaceFolderPath = pathFromUriString(workspaceFolder.uri) || "";
      if (fs.existsSync(this.workspaceFolderPath)) {

        const files = fs.readdirSync(this.workspaceFolderPath);

        // first scan for .rpw-project file
        for (let i = 0; i < files.length; i += 1) {
          if (files[i].toLowerCase().indexOf(".rpw-project") == -1) {
            continue;
          }
          const jsonData = fs.readFileSync(files[i], 'utf8');
          const rpwProject = <asm.RpwProject>JSON.parse(jsonData)
          // *** error handling ***
          const project = new LspProject(this, this.workspaceFolderPath)
          if (!project.loadProject(rpwProject)) {
            // *** error handling ***
          }
          this.projects.push(project)
          break;
        }

        // if no project, scan for ASM.* files
        if (this.projects.length == 0) {
          for (let i = 0; i < files.length; i += 1) {
            if (files[i].toUpperCase().indexOf("ASM.") != 0) {
              continue
            }
            if (!this.addFileProject(files[i], false)) {
              // *** error handling ***
            }
            break
          }
        }
      }
    }

    this.updateProjects()

    // *** send diagnostics on all updated files (just once) ***
    // for (let i = 0; i < this.projects.length; i += 1) {
    //   this.projects[i].updateDiagnostics()
    // }
  }

  // *** think about cancellation token support ***
  private updateProjects(diagnostics = false) {
    for (let i = 0; i < this.projects.length; i += 1) {
      this.projects[i].update()
      // TODO: something else?
    }

    // *** send message that semantic tokens need refresh ***
    // this.connection.sendNotification("workspace/semanticTokens/refresh")
  }

  private addFileProject(path: string, temporary: boolean): LspProject | undefined {
    let project: LspProject
    let fileName: string
    if (path.indexOf(this.workspaceFolderPath) == 0) {
      fileName = path.substring(this.workspaceFolderPath.length + 1)
      project = new LspProject(this, this.workspaceFolderPath, temporary)
    } else {
      const index = path.lastIndexOf("/")
      if (index == -1) {
        fileName = path
        project = new LspProject(this, path, temporary)
      } else {
        fileName = path.substring(index + 1)
        project = new LspProject(this, path.substring(0, index), temporary)
      }
    }
    const rpwModule: asm.RpwModule = {
      start: fileName,
      srcbase: ""
    }
    if (!project.loadModule(rpwModule)) {
      // *** error handling ***
      return
    }
    this.projects.push(project)
    return project
  }

  onDidOpenTextDocument(params: lsp.DidOpenTextDocumentParams): void {
    const filePath = pathFromUriString(params.textDocument.uri);
    if (filePath) {
      if (this.documents.open(filePath, params.textDocument)) {
        const document = this.documents.get(filePath)
        if (document) {
          let sourceFile = this.findSourceFile(filePath)
          if (!sourceFile) {
            const project = this.addFileProject(filePath, true)
            if (!project) {
              // *** error handling ***
              return
            }
            project.update()
            sourceFile = this.findSourceFile(filePath)
            if (!sourceFile) {
              // *** error handling ***
              return
            }
          }
          this.updateDiagnostics(sourceFile)
        }
      }
    }
  }

  onDidCloseTextDocument(params: lsp.DidCloseTextDocumentParams): void {
    const filePath = pathFromUriString(params.textDocument.uri);
    if (filePath) {
      let sourceFile = this.findSourceFile(filePath)
      if (sourceFile) {
        const project = sourceFile.module.project as LspProject
        if (project && project.temporary) {
          const index = this.projects.indexOf(project)
          this.projects.splice(index, 1)
        }
      }
      this.documents.close(filePath);
    }
  }

  onDidChangeTextDocument(params: lsp.DidChangeTextDocumentParams): void {
    const { textDocument } = params
    const filePath = pathFromUriString(params.textDocument.uri)
    if (filePath) {
      const document = this.documents.get(filePath)
      if (document) {
        for (const change of params.contentChanges) {
          document.applyEdit(textDocument.version, change)
        }

        // *** mark as dirty the file/projects that changed ***
        this.updateProjects()   // ***

        const sourceFile = this.findSourceFile(filePath)
        if (sourceFile) {
          this.updateDiagnostics(sourceFile)
        }
      }
    }
  }

  // *** how to suppress default completion values from file? ***

  async onCompletion(params: lsp.CompletionParams, token?: lsp.CancellationToken): Promise<lsp.CompletionList | null> {
    const completions: lsp.CompletionItem[] = []
    const isIncomplete = false

    // figure out where in the line we are
      // if operation/keyword known, choose possible symbols
        // if JMP/JSR, list globals
        // if Bcc, list locals, nearby globals
        // if opcode is immediate (#), list constants
        // if #> or #<, list globals, large constants

    let includedTypes = 7 //0
    const filePath = pathFromUriString(params.textDocument.uri)
    if (filePath) {
      const sourceFile = this.findSourceFile(filePath)
      if (sourceFile) {
        const statement = sourceFile.statements[params.position.line]
        if (statement) {

          // *** if token missed, look for token just before/after it ***

          const token = statement.getTokenAt(params.position.character)
          if (token) {
            // no completions if in comments
            if (token.type != TokenType.Comment) {

              // if after opcode, allow items by op type
              // const hitIndex = statement.tokens.indexOf(token)
              // for (let i = 0; i < statement.tokens.length; i += 1) {
              //   const t = statement.tokens[i]
              // }

              // *** do something with position too? ***
                // before/after opcode
                // inside comment
              // *** filter zpage/const/address ***
            }
          }
        } else {
          // ***
        }

        if (includedTypes) {
          // *** exclude constants if in non-immediate opcode
          // *** watch out for errors and warnings?
          sourceFile.module.symbols.map.forEach((value, key: string) => {

            // *** consider adding source file name where found, in details ***

            // TODO: more here

            let item: lsp.CompletionItem
            if (value.type == SymbolType.Constant) {
              if (!(includedTypes & 1)) {
                return
              }
              item = lsp.CompletionItem.create(key)
              item.kind = lsp.CompletionItemKind.Constant
            } else if (value.type == SymbolType.ZPage) {
              if (!(includedTypes & 2)) {
                return
              }
              item = lsp.CompletionItem.create(key)
              item.kind = lsp.CompletionItemKind.Variable
            } else {
              if (!(includedTypes & 4)) {
                return
              }
              item = lsp.CompletionItem.create(key)
              item.kind = lsp.CompletionItemKind.Function
            }

            // *** item.detail = "detail text"
            // *** item.labelDetails = { detail: " label det", description: "label det desc" }

            item.data = { filePath: value.sourceFile.path, line: value.lineNumber }
            completions.push(item)
          })
        }
      }
    }

    return lsp.CompletionList.create(completions, isIncomplete)
  }

  async onCompletionResolve(item: lsp.CompletionItem, token?: lsp.CancellationToken): Promise<lsp.CompletionItem> {
    if (item.data.filePath) {
      const sourceFile = this.findSourceFile(item.data.filePath)
      if (sourceFile) {
        if (item.kind == lsp.CompletionItemKind.Function) {
          const header = this.getCommentHeader(sourceFile, item.data.line)
          if (header) {
            item.documentation = { kind: "markdown", value: header }
          }
        } else {
          // *** something for constants and vars ***
        }
      }
    }
    return item
  }

  async onDefinition(params: lsp.DefinitionParams, token?: lsp.CancellationToken): Promise<lsp.Definition | lsp.DefinitionLink[] | undefined> {
    const filePath = pathFromUriString(params.textDocument.uri)
    if (filePath) {
      // TODO: if symbol is entry point, scan entire project, skip duplicates
      let sourceFile = this.findSourceFile(filePath)
      if (sourceFile) {
        const statement = sourceFile.statements[params.position.line]
        if (statement) {
          const token = statement.getTokenAt(params.position.character)
          if (token && token.symbol) {
            const dstStatement = token.symbol.sourceFile.statements[token.symbol.lineNumber]
            const dstTokens = dstStatement.getTokens()
            const dstToken = dstTokens[0]
            let range: lsp.Range = {
              start: { line: token.symbol.lineNumber, character: dstToken.start },
              end: { line: token.symbol.lineNumber, character: dstToken.end }
            }
            // *** just use lsp.Definition instead? ***
            let targetLink: lsp.DefinitionLink = {
              targetUri: URI.file(token.symbol.sourceFile.path).toString(),
              targetRange: range,
              targetSelectionRange: range
            }
            return [ targetLink ]
          }
        }
      }
    }
  }

  async onExecuteCommand(params: lsp.ExecuteCommandParams, token?: lsp.CancellationToken, workDoneProgress?: lsp.WorkDoneProgressReporter): Promise<any> {
    if (params.command == "rpw65.renumberLocals") {
      if (params.arguments === undefined || params.arguments.length < 2) {
        return;
      }

      const filePath = pathFromUriString(params.arguments[0])
      if (!filePath) {
        return
      }

      // *** fold this into something else? ***
      const textDocument = this.documents.get(filePath)
      if (textDocument === undefined) {
        return
      }

      const sourceFile = this.findSourceFile(filePath)
      if (!sourceFile) {
        return
      }

      const range = params.arguments[1] as lsp.Range
      if (!range) {
        return
      }

      const scanner = new LabelScanner()
      const lineEdits = scanner.renumberLocals(sourceFile.statements, range.start.line, range.end.line)
      if (!lineEdits) {
        return
      }

      const edits: lsp.TextEdit[] = []
      for (let i = 0; i < lineEdits.length; i += 1) {
        const lineEdit = lineEdits[i]
        const edit: lsp.TextEdit = {
          range: {
            start: { line: lineEdit.line, character: lineEdit.start },
            end: { line: lineEdit.line, character: lineEdit.end }
          },
          newText: lineEdit.text
        }
        edits.push(edit)
      }
      return { textDocument: { uri: textDocument.uri, version: textDocument.version }, edits: edits }
    }
  }

  async onFoldingRanges(params: lsp.FoldingRangeParams, token?: lsp.CancellationToken): Promise<lsp.FoldingRange[] | undefined> {
    const foldingRanges: lsp.FoldingRange[] = []
    const filePath = pathFromUriString(params.textDocument.uri)
    if (filePath) {
      let sourceFile = this.findSourceFile(filePath)
      if (sourceFile) {
        sourceFile.statements.forEach(statement => {
          const nextConditional = (statement as any).nextConditional
          if (nextConditional && sourceFile) {
            const startLine = sourceFile.statements.indexOf(statement)
            const endLine = sourceFile.statements.indexOf(nextConditional) - 1
            if (startLine < endLine) {
              const range: lsp.FoldingRange = {
                startLine, endLine
              }
              foldingRanges.push(range)
            }
          }
        })
      }
    }
    return foldingRanges
  }

  // TODO: if symbol is an entry point, walk all modules of project
  async onHover(params: lsp.TextDocumentPositionParams, token?: lsp.CancellationToken): Promise<lsp.Hover> {
    const filePath = pathFromUriString(params.textDocument.uri);
    if (!filePath) {
      return { contents: [] };
    }

    const sourceFile = this.findSourceFile(filePath)
    if (!sourceFile) {
      return { contents: [] };
    }

    const statement = sourceFile.statements[params.position.line];
    if (statement) {
      const token = statement.getTokenAt(params.position.character);
      if (token) {

        // *** TODO: if hovering over macro invocation, show macro contents ***

        if (token.type == TokenType.Symbol) {
          // if local, may need to build and find full name
          const str = token.getString()
          // (will eventually require walk across projects/ENT files)
          const symbol = sourceFile.module.symbols.find(str);
          if (symbol !== undefined) {
            let header = this.getCommentHeader(symbol.sourceFile, symbol.lineNumber)
            if (header) {
              return { contents: header };
            }
          }
        }
      }
    }

    return { contents: [] }
  }

  // TODO: if symbol is an entry point, walk all modules of project
  async onReferences(params: lsp.ReferenceParams, token?: lsp.CancellationToken): Promise<lsp.Location[]> {
    const locations: lsp.Location[] = []
    const filePath = pathFromUriString(params.textDocument.uri)
    if (filePath) {
      const sourceFile = this.findSourceFile(filePath)
      if (sourceFile) {
        const statement = sourceFile.statements[params.position.line]
        if (statement !== undefined) {
          const token = statement.getTokenAt(params.position.character)
          if (token && token.symbol) {
            const module = sourceFile.module
            module.sourceFiles.forEach((sourceFile: asm.SourceFile) => {
              sourceFile.statements.forEach((refStatement: stm.Statement, refIndex: number) => {
                const refTokens = refStatement.getTokens()
                for (let i = 0; i < refTokens.length; i += 1) {
                  const refToken = refTokens[i]
                  if (refToken.symbol == token.symbol) {
                    let location: lsp.Location = {
                      uri: URI.file(sourceFile.path).toString(),
                      range: {
                        start: { line: refIndex, character: refToken.start },
                        end: { line: refIndex, character: refToken.end }
                      }
                    }
                    locations.push(location)
                  }
                }
              })
            })
          }
        }
      }
    }
    return locations
  }

  public updateDiagnostics(sourceFile: asm.SourceFile) {

    const scanner = new LabelScanner();
    scanner.scanStatements(sourceFile.statements);

    const diagnostics: lsp.Diagnostic[] = [];
    for (let i = 0; i < sourceFile.statements.length; i += 1) {
      const statement = sourceFile.statements[i];
      const tokens = statement.getTokens()
      // TODO: mark statement with error and skip token scan here
      for (let j = 0; j < tokens.length; j += 1) {
        const token = tokens[j];
        if (token.errorType != TokenErrorType.None) {
          let severity: lsp.DiagnosticSeverity;
          switch (token.errorType) {
            default:
            case TokenErrorType.Error:
              severity = lsp.DiagnosticSeverity.Error;        // red line
              break;
            case TokenErrorType.Warning:
              severity = lsp.DiagnosticSeverity.Warning;      // yellow line
              break;
            case TokenErrorType.Info:
              severity = lsp.DiagnosticSeverity.Information;  // blue line
              break;
          }
          if (token.start == token.end) {
            console.log();
          }
          const lspDiagnostic: lsp.Diagnostic = {
            range: {
              start: { line: i, character: token.start},
              end: { line: i, character: Math.max(token.end, token.start + 1)}
              // end: { line: i, character: token.end }
            },
            message: token.errorMessage ?? "",
            severity: severity
            // code:,
            // source:,
            // relatedInformation:,
          };
          diagnostics.push(lspDiagnostic);
        }
      }
    }

    this.connection.sendDiagnostics({
      uri: URI.file(sourceFile.path).toString(),
      diagnostics: diagnostics });
  }

  async onSemanticTokensFull(params: lsp.SemanticTokensParams, token?: lsp.CancellationToken): Promise<lsp.SemanticTokens> {
    const filePath = pathFromUriString(params.textDocument.uri);
    if (!filePath) {
      return { data: [] };
    }

    const sourceFile = this.findSourceFile(filePath)
    if (!sourceFile) {
      return { data: [] };
    }

    // export enum SemanticToken {
    //   invalid   = 0,
    //   comment   = 1,
    //   string    = 2,
    //   number    = 3,
    //   operator  = 4,
    //   keyword   = 5,
    //   label     = 6,
    //   macro     = 7,
    
    //   opcode    = 8,
    //   constant  = 9,
    //   zpage     = 10,
    //   var       = 11
    // }
    
    // export enum SemanticModifier {
    //   local     = 0,
    //   global    = 1,
    //   external  = 2,
    //   unused    = 3
    // }
    
    const data: number[] = [];
    const statements = sourceFile.statements;
    let prevLine = 0;
    for (let i = 0; i < statements.length; i += 1) {
      const statement = statements[i];
      const tokens = statement.getTokens()
      let prevStart = 0;
      for (let j = 0; j < tokens.length; j += 1) {
        let index = -1
        let bits = 0
        const token = tokens[j];
        if (token.type == TokenType.Comment) {
          index = SemanticToken.comment
        } else if (token.type == TokenType.Keyword) {
          index = SemanticToken.keyword
        } else if (token.type == TokenType.Opcode) {
          index = SemanticToken.opcode
        } else if (token.type == TokenType.Label || token.type == TokenType.Symbol) {
          if (token.symbol !== undefined) {
            if (token.symbol.type === undefined) {
              index = SemanticToken.label
            } else if (token.symbol.type == SymbolType.Constant) {
              index = SemanticToken.constant
            } else if (token.symbol.type == SymbolType.ZPage) {
              index = SemanticToken.zpage
            }
            // *** apply unused ***
            // *** apply global and/or external ***
          }
        } else if (token.type == TokenType.LocalLabel
          || token.type == TokenType.LocalLabelPrefix) {
          index = SemanticToken.label
          bits |= (1 << SemanticModifier.local)
          // *** apply unused ***
        } else if (token.type == TokenType.Operator) {
          index = SemanticToken.operator
        } else if (token.type == TokenType.Macro) {
          index = SemanticToken.macro
        } else if (token.type == TokenType.DecNumber ||
            token.type == TokenType.HexNumber) {
          // if ((statement instanceof xxx.OpStatement) && statement.type == "HEX") {
          //   // TODO: maybe a different color for long HEX AAAAAAAA statements?
          // } else {
            index = SemanticToken.number
          // }
        } else if (token.type == TokenType.Variable
          || token.type == TokenType.VariablePrefix) {
          index = SemanticToken.var
        } else if (token.type == TokenType.FileName) {
          index = SemanticToken.string                  // TODO: something else
        } else if (token.type == TokenType.String) {
          index = SemanticToken.string
        } else {
          index = SemanticToken.invalid
        }

        if (index >= 0) {
          data.push(i - prevLine, token.start - prevStart, token.length, index, bits)
          prevStart = token.start
          prevLine = i
        }
      }
    }

    return { data: data }
  }

  async onSemanticTokensRange(params: lsp.SemanticTokensRangeParams, token?: lsp.CancellationToken): Promise<lsp.SemanticTokens> {
    
    // *** add this (change client setting too) ***
    
    return { data: [] };
  }

  // TODO: move some of this into sourceFile?
  private getCommentHeader(atFile: asm.SourceFile, atLine: number): string | undefined {

    // scan up from hover line looking for comment blocks
    let startLine = atLine;
    while (startLine > 0) {
      startLine -= 1;
      const statement = atFile.statements[startLine]
      const tokens = statement.getTokens()

      // include empty statements
      if (tokens.length == 0) {
        continue;
      }
      // stop when first non-comment statement found
      if (tokens[0].type != TokenType.Comment) {
        startLine += 1;
        break;
      }
    }

    while (startLine < atLine) {
      const sourceLine = atFile.statements[startLine].sourceLine;
      if (sourceLine != ";" && sourceLine != "" && !sourceLine.startsWith(";-")) {
        break;
      }
      startLine += 1;
    }

    while (atLine > startLine) {
      const sourceLine = atFile.statements[atLine - 1].sourceLine;
      if (sourceLine != ";" && sourceLine != "" && !sourceLine.startsWith(";-")) {
        break;
      }
      atLine -= 1;
    }

    if (startLine != atLine) {
      let header = "```  \n"
      for (let i = startLine; i < atLine; i += 1) {
        const statement = atFile.statements[i]
        header += statement.sourceLine + "  \n"
      }
      header += "```"
      return header
    }
  }
}

/* based on SublimeText Mariana */
// .cm-s-dbug.CodeMirror {
//   background: hsl(0, 0%, 10%); #1a1a1a
//   color: hsl(0, 0%, 70%);      #b3b3b3
// }
// .cm-s-dbug span.cm-comment { color: hsl(114, 30%, 40%); }      #4e8547
// .cm-s-dbug span.cm-string { color: hsl(32, 93%, 66%); }        #f9ae58
// .cm-s-dbug span.cm-keyword { color: hsl(300, 50%, 68%); }      #d685d6
// .cm-s-dbug span.cm-opcode { color: hsl(210, 50%, 60%); }     	#6699cc
// .cm-s-dbug span.cm-label { color: hsl(32, 93%, 66%); }         #f9ae58
// .cm-s-dbug span.cm-local { color: #9effff; }    /*** CHANGE THIS ***/
// .cm-s-dbug span.cm-operator { color: #845dc4; }    /*** CHANGE THIS ***/
// .cm-s-dbug span.cm-number { color: #ff80e1; }

//------------------------------------------------------------------------------
