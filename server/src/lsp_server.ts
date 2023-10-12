
import * as lsp from 'vscode-languageserver';
import { URI } from 'vscode-uri';
import * as fs from 'fs';

import { TextDocument } from 'vscode-languageserver-textdocument'
import { RpwProject, RpwModule, Project, SourceFile } from "./asm/project"
import { Node, NodeErrorType, Token, TokenType } from "./asm/tokenizer"
import * as exp from "./asm/expressions"
import { Statement } from "./asm/statements"
import { SymbolType, Symbol } from "./asm/symbols"
import { renumberLocals, renameSymbol } from "./asm/labels"

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

  function  = 8,
  buffer    = 9,
  opcode    = 10,
  constant  = 11,
  zpage     = 12,
  var       = 13,
  escape    = 14,
}

export enum SemanticModifier {
  local     = 0,
  global    = 1,
  external  = 2,
  unused    = 3
}

//------------------------------------------------------------------------------

// *** this needs cleanup, fix Windows normalization ***
// *** look at protocol-translation.ts in tslsp

export function pathFromUriString(stringUri: string): string | undefined {
  const uri = URI.parse(stringUri);
  if (uri.scheme == 'file') {
    const fsPath = URI.file(uri.fsPath).fsPath;
    const RE_PATHSEP_WINDOWS = /\\/g;
    return fsPath.replace(RE_PATHSEP_WINDOWS, '/');
  }
}

function uriFromPath(path: string) {
  return URI.file(path).toString()
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

class LspProject extends Project {

  private server: LspServer

  constructor(server: LspServer) {
    super()
    this.server = server
  }

  getFileContents(fullPath: string): string | undefined {
    // look through open documents first
    const document = this.server.documents.get(fullPath)
    if (document) {
      return document.getText()
    }
    // if no open document, got look in file system
    return super.getFileContents(fullPath)
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

type SemanticState = {
  prevLine: number,
  prevStart: number,
  data: number[]
}

type DiagnosticState = {
  lineNumber: number,
  diagnostics: lsp.Diagnostic[]
}

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
    connection.onPrepareRename(this.onPrepareRename.bind(this))
    connection.onRenameRequest(this.onRename.bind(this))
    connection.languages.semanticTokens.on(this.onSemanticTokensFull.bind(this))
    connection.languages.semanticTokens.onRange(this.onSemanticTokensRange.bind(this))
  }

  private getSourceFile(uri: string): SourceFile | undefined {
    const filePath = pathFromUriString(uri)
    if (filePath) {
      return this.findSourceFile(filePath)
    }
  }

  private getStatement(uri: string, lineNumber: number): Statement | undefined {
    const sourceFile = this.getSourceFile(uri)
    if (sourceFile) {
      return sourceFile.statements[lineNumber]
    }
  }

  // *** just use a map lookup directly? ***
  private findSourceFile(filePath: string): SourceFile | undefined {
    for (let i = 0; i < this.projects.length; i += 1) {
      const sourceFile = this.projects[i].findSourceFile(filePath)
      if (sourceFile) {
        return sourceFile
      }
    }
  }

  onInitialize(params: lsp.InitializeParams): void {

    const n = 1
    while (n) {
      console.log()  // ***
    }

    if (params.workspaceFolders) {
      // *** walk each folder -- or don't support multiple folders ***
      const workspaceFolder = params.workspaceFolders[0]
      // move to this.workspaceFolderPath
      this.workspaceFolderPath = pathFromUriString(workspaceFolder.uri) || ""
      if (fs.existsSync(this.workspaceFolderPath)) {

        const files = fs.readdirSync(this.workspaceFolderPath)

        // first scan for .rpw-project file
        for (let file of files) {
          if (file.toLowerCase().indexOf(".rpw-project") == -1) {
            continue
          }
          const jsonData = fs.readFileSync(file, 'utf8')
          const rpwProject = <RpwProject>JSON.parse(jsonData)
          // *** error handling ***

          const project = new LspProject(this)
          if (!project.loadProject(this.workspaceFolderPath, rpwProject)) {
            // *** error handling ***
          }
          this.projects.push(project)
          break
        }

        // if no project, scan for ASM.* files
        // if (this.projects.length == 0) {
        //   for (let i = 0; i < files.length; i += 1) {
        //     if (files[i].toUpperCase().indexOf("ASM.") != 0) {
        //       continue
        //     }
        //     if (!this.addFileProject(files[i], false)) {
        //       // *** error handling ***
        //     }
        //     break
        //   }
        // }
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

  // build a tempory project given a file path
  private addFileProject(path: string, temporary: boolean): LspProject | undefined {
    let fileName: string
    let directory: string
    if (path.indexOf(this.workspaceFolderPath) == 0) {
      fileName = path.substring(this.workspaceFolderPath.length + 1)
      directory = this.workspaceFolderPath
    } else {
      const index = path.lastIndexOf("/")
      if (index == -1) {
        fileName = path
        directory = "."
      } else {
        fileName = path.substring(index + 1)
        directory = path.substring(0, index)
      }
    }
    let rpwProject: RpwProject = {}
    rpwProject.modules = []
    rpwProject.modules.push({src: fileName})
    const project = new LspProject(this)
    project.loadProject(directory, rpwProject, true)
    this.projects.push(project)
    return project
  }

  onDidOpenTextDocument(params: lsp.DidOpenTextDocumentParams): void {
    const filePath = pathFromUriString(params.textDocument.uri)
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
        this.updateProjects()

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

          const res = statement.findExpressionAt(params.position.character)
          if (res) {
            // no completions if in comments
            if (res.token.type != TokenType.Comment) {

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
          sourceFile.module.symbolMap.forEach((symbol: Symbol, key: string) => {

            if (symbol.type != SymbolType.Simple) {
              return
            }

            // *** consider adding source file name where found, in details ***

            // TODO: more here

            let item: lsp.CompletionItem
            if (symbol.isConstant) {
              if (!(includedTypes & 1)) {
                return
              }
              item = lsp.CompletionItem.create(key)
              item.kind = lsp.CompletionItemKind.Constant
            } else if (symbol.isZPage) {
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

            item.data = { filePath: symbol.definition.sourceFile?.fullPath, line: symbol.definition.lineNumber }
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

  async onExecuteCommand(params: lsp.ExecuteCommandParams, token?: lsp.CancellationToken, workDoneProgress?: lsp.WorkDoneProgressReporter): Promise<any> {
    if (params.command == "rpw65.renumberLocals") {

      // TODO: make this a call to separate method

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

      const fileEdits = renumberLocals(sourceFile, range.start.line, range.end.line)
      if (!fileEdits || fileEdits.size > 1) {
        return
      }

      const lineEdits = fileEdits.get(sourceFile)
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
    let sourceFile = this.getSourceFile(params.textDocument.uri)
    if (sourceFile) {
      // TODO: could support folding macro definitions
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
    return foldingRanges
  }

  // TODO: if symbol is an entry point, walk all modules of project
  async onHover(params: lsp.TextDocumentPositionParams, token?: lsp.CancellationToken): Promise<lsp.Hover> {
    const statement = this.getStatement(params.textDocument.uri, params.position.line)
    if (statement) {
      const res = statement.findExpressionAt(params.position.character)
      if (res && res.expression instanceof exp.SymbolExpression) {
        const hoverExp = res.expression
        // TODO: if hovering over macro invocation, show macro contents
        if (hoverExp instanceof exp.SymbolExpression) {
          if (hoverExp.isDefinition) {
            // *** show value of symbol, if resolved
          } else if (hoverExp.symbol) {
            const defExp = hoverExp.symbol?.definition
            if (defExp && defExp.sourceFile) {
              // *** also show value, if resolved
              let header = this.getCommentHeader(defExp.sourceFile, defExp.lineNumber)
              if (header) {
                return { contents: header }
              }
            }
          }
        }
      }
    }

    return { contents: [] }
  }

  async onDefinition(params: lsp.DefinitionParams, token?: lsp.CancellationToken): Promise<lsp.Definition | lsp.DefinitionLink[] | undefined> {
    const statement = this.getStatement(params.textDocument.uri, params.position.line)
    if (statement) {
      const res = statement.findExpressionAt(params.position.character)
      // TODO: support macro definitions
      // TODO: support include/PUT files
      if (res && res.expression instanceof exp.SymbolExpression) {
        const symExp = res.expression
        let symbol = symExp.symbol
        if (symbol) {
          const expRange = symbol.definition.getRange()
          if (expRange && symbol.definition.sourceFile) {
            let range: lsp.Range = {
              start: { line: symbol.definition.lineNumber, character: expRange.start },
              end: { line: symbol.definition.lineNumber, character: expRange.end }
            }
            // TODO: is there value in using lsp.DefinitionLink instead of just lsp.Definition?
            let targetLink: lsp.DefinitionLink = {
              targetUri: URI.file(symbol.definition.sourceFile.fullPath).toString(),
              targetRange: range,
              targetSelectionRange: range
            }
            return [ targetLink ]
          }
        }
      }
    }
  }

  // TODO: if symbol is an entry point, walk all modules of project
  async onReferences(params: lsp.ReferenceParams, token?: lsp.CancellationToken): Promise<lsp.Location[]> {
    const locations: lsp.Location[] = []
    const statement = this.getStatement(params.textDocument.uri, params.position.line)
    if (statement) {
      // TODO: support macros definitions and references
      const symbol = statement?.labelExp?.symbol
      if (symbol) {
        symbol.references.forEach(symExp => {
          const expRange = symExp.getRange()
          if (expRange && symExp.sourceFile) {
            let location: lsp.Location = {
              uri: URI.file(symExp.sourceFile.fullPath).toString(),
              range: {
                start: { line: symExp.lineNumber, character: expRange.start },
                end: { line: symExp.lineNumber, character: expRange.end }
              }
            }
            locations.push(location)
          }
        })
      }
    }
    return locations
  }

  async onPrepareRename(params: lsp.PrepareRenameParams, token?: lsp.CancellationToken): Promise<lsp.Range | { range: lsp.Range; placeholder: string; } | undefined | null> {
    const statement = this.getStatement(params.textDocument.uri, params.position.line)
    if (statement) {
      const res = statement.findExpressionAt(params.position.character)
      // TODO: support macro rename
      if (res && res.expression instanceof exp.SymbolExpression) {
        const symExp = res.expression
        let symbol = symExp.symbol
        if (symbol) {
          const token = symbol.getSimpleNameToken()
          let range: lsp.Range = {
            start: { line: symbol.definition.lineNumber, character: token.start },
            end: { line: symbol.definition.lineNumber, character: token.end }
          }
          return { range, placeholder: token.getString() }
        }
      }
    }
  }

  async onRename(params: lsp.RenameParams, token?: lsp.CancellationToken): Promise<lsp.WorkspaceEdit | undefined | null> {
    const statement = this.getStatement(params.textDocument.uri, params.position.line)
    if (statement) {
      const res = statement.findExpressionAt(params.position.character)
      // TODO: support macro rename
      if (res && res.expression instanceof exp.SymbolExpression) {
        const symExp = res.expression
        let symbol = symExp.symbol
        if (symbol) {
          // *** make sure new name won't cause duplicate label problems ***
          const fileEdits = renameSymbol(symbol, params.newName)
          if (fileEdits) {
            const changes: lsp.WorkspaceEdit['changes'] = {}
            fileEdits.forEach((value, key) => {
              const sourceFile = key
              const lineEdits = value
              const uri = uriFromPath(sourceFile.fullPath)
              const textEdits = changes[uri] || (changes[uri] = [])
              for (let i = 0; i < lineEdits.length; i += 1) {
                const lineEdit = lineEdits[i]
                const edit: lsp.TextEdit = {
                  range: {
                    start: { line: lineEdit.line, character: lineEdit.start },
                    end: { line: lineEdit.line, character: lineEdit.end }
                  },
                  newText: lineEdit.text
                }
                textEdits.push(edit)
              }
            })
            return { changes }
          }
        }
      }
    }
  }

  // TODO: consider a range of lines?
  public updateDiagnostics(sourceFile: SourceFile) {

    const diagnostics: lsp.Diagnostic[] = []
    const state: DiagnosticState = { lineNumber: 0, diagnostics }

    for (let i = 0; i < sourceFile.statements.length; i += 1) {
      const statement = sourceFile.statements[i]
      state.lineNumber = i
      this.diagnoseExpression(state, statement)
    }

    this.connection.sendDiagnostics({
      uri: URI.file(sourceFile.fullPath).toString(),
      diagnostics: diagnostics })
  }

  private diagnoseExpression(state: DiagnosticState, expression: exp.Expression) {
    if (expression.errorType != NodeErrorType.None) {
      this.diagnoseNode(state, expression)
      return
    }
    for (let i = 0; i < expression.children.length; i += 1) {
      const node = expression.children[i]
      if (node instanceof exp.Expression) {
        this.diagnoseExpression(state, node)
      } else {
        this.diagnoseNode(state, node)
      }
    }
  }

  private diagnoseNode(state: DiagnosticState, node: Node) {
    if (node.errorType != NodeErrorType.None) {
      let severity: lsp.DiagnosticSeverity
      switch (node.errorType) {
        default:
        case NodeErrorType.Error:
          severity = lsp.DiagnosticSeverity.Error       // red line
          break
        case NodeErrorType.Warning:
          severity = lsp.DiagnosticSeverity.Warning     // yellow line
          break
        case NodeErrorType.Info:
          severity = lsp.DiagnosticSeverity.Information // blue line
          break
      }

      const nodeRange = node.getRange()
      if (nodeRange) {
        const lspDiagnostic: lsp.Diagnostic = {
          range: {
            start: { line: state.lineNumber, character: nodeRange.start },
            end: { line: state.lineNumber, character: Math.max(nodeRange.end, nodeRange.start + 1) }
          },
          message: node.errorMessage ?? "",
          severity: severity
          // code:,
          // source:,
          // relatedInformation:,
        }
        state.diagnostics.push(lspDiagnostic)
      }
    }
  }

  async onSemanticTokensFull(params: lsp.SemanticTokensParams, token?: lsp.CancellationToken): Promise<lsp.SemanticTokens> {
    const sourceFile = this.getSourceFile(params.textDocument.uri)
    if (sourceFile) {
      return this.getSemanticTokens(sourceFile, 0, sourceFile.statements.length)
    } else {
      return { data: [] }
    }
  }

  async onSemanticTokensRange(params: lsp.SemanticTokensRangeParams, token?: lsp.CancellationToken): Promise<lsp.SemanticTokens> {
    const sourceFile = this.getSourceFile(params.textDocument.uri)
    if (sourceFile) {
      return this.getSemanticTokens(sourceFile, params.range.start.line, params.range.end.line)
    } else {
      return { data: [] }
    }
  }

  private getSemanticTokens(sourceFile: SourceFile, startLine: number, endLine: number): lsp.SemanticTokens {
    const data: number[] = []
    const state: SemanticState = { prevLine: 0, prevStart: 0, data: data }
    for (let i = startLine; i < endLine; i += 1) {
      state.prevStart = 0
      // *** mark unused lines (inside disabled conditional) so they're dimmed ***
      this.semanticExpression(state, i, sourceFile.statements[i])
    }
    return { data }
  }

  private semanticExpression(state: SemanticState, lineNumber: number, expression: exp.Expression) {
    if (expression instanceof exp.SymbolExpression) {
      const symExp = expression
      for (let i = 0; i < symExp.children.length; i += 1) {
        const token = symExp.children[i]
        if (token instanceof Token) {
          // *** get rid of Symbol check? ***
          if (token.type == TokenType.Label || token.type == TokenType.Symbol) {
            let index = SemanticToken.invalid
            let bits = 0
            if (symExp.isLocalType()) {
              index = SemanticToken.label
              bits |= (1 << SemanticModifier.local)
              if (symExp.symbol?.references.length == 0) {
                bits |= (1 << SemanticModifier.unused)
              }
            } else if (symExp.symbol) {
              if (symExp.symbol.isZPage) {
                index = SemanticToken.zpage
              } else if (symExp.symbol.isConstant) {
                index = SemanticToken.constant
              } else if (symExp.symbol.isMacro) {
                index = SemanticToken.macro
              } else if (symExp.symbol.isSubroutine) {
                // *** maybe skip for locals? ***
                index = SemanticToken.function
              } else if (symExp.symbol.isData) {
                index = SemanticToken.buffer
              } else if (symExp.symbol.isCode) {
                index = SemanticToken.label
              }
              if (symExp.symbol.isEntryPoint) {
                index = SemanticToken.function    //*** only if still symbol?
                bits |= (1 << SemanticModifier.external)
              }
              if (symExp.isDefinition) {
                if (symExp.symbol.isEntryPoint) {
                  // NOTE: for now, don't ever mark entry points as unused
                  // TODO: revisit once entry points are linked project-wide
                } else if (symExp.symbol.references.length == 0) {
                  // *** only apply if within full project ???
                  bits |= (1 << SemanticModifier.unused)
                }
              }
            } else {
              // TODO: what if label doesn't have symbol?
              //  (assume it's already been marked with an error?)
              continue
            }
            if (index == SemanticToken.invalid) {   // ***
              continue
            }
            state.data.push(lineNumber - state.prevLine, token.start - state.prevStart, token.length, index, bits)
            state.prevStart = token.start
            state.prevLine = lineNumber
          } else {
            this.semanticToken(state, lineNumber, token)
          }
        }
      }
    } else {
      for (let i = 0; i < expression.children.length; i += 1) {
        const child = expression.children[i]
        if (child instanceof Token) {
          this.semanticToken(state, lineNumber, child)
        } else if (child instanceof exp.Expression) {
          this.semanticExpression(state, lineNumber, child)
        }
      }
    }
  }

  private semanticToken(state: SemanticState, lineNumber: number, token: Token) {
    let index = -1
    let bits = 0
    if (token.type == TokenType.Comment) {
      index = SemanticToken.comment
    } else if (token.type == TokenType.Keyword) {
      index = SemanticToken.keyword
    } else if (token.type == TokenType.Opcode) {
      index = SemanticToken.opcode
    } else if (token.type == TokenType.Operator) {
      index = SemanticToken.operator
    } else if (token.type == TokenType.Macro) {
      index = SemanticToken.macro
    } else if (token.type == TokenType.DecNumber
        || token.type == TokenType.HexNumber) {
      index = SemanticToken.number
    } else if (token.type == TokenType.Variable) {
      index = SemanticToken.var
    } else if (token.type == TokenType.FileName) {
      index = SemanticToken.string                  // TODO: something else?
    } else if (token.type == TokenType.String
        || token.type == TokenType.Quote) {
      index = SemanticToken.string
    } else if (token.type == TokenType.Escape) {
      index = SemanticToken.escape
    } else {
      index = SemanticToken.invalid
    }
    if (index >= 0) {
      state.data.push(lineNumber - state.prevLine, token.start - state.prevStart, token.length, index, bits)
      state.prevStart = token.start
      state.prevLine = lineNumber
    }
  }


  // TODO: move some of this into sourceFile?
  private getCommentHeader(atFile: SourceFile, atLine: number): string | undefined {

    // scan up from hover line looking for comment blocks
    let startLine = atLine
    while (startLine > 0) {
      startLine -= 1
      const token = atFile.statements[startLine].children[0]

      // include empty statements
      if (token == undefined) {
        continue
      }

      // stop when first non-comment statement found
      if (!(token instanceof Token) || token.type != TokenType.Comment) {
        startLine += 1
        break
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

//------------------------------------------------------------------------------
