
import * as fs from 'fs'
import * as lsp from 'vscode-languageserver'
import { URI } from 'vscode-uri'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { TextDocuments, DidChangeConfigurationNotification } from 'vscode-languageserver/node'

import { RpwProject, RpwSettings, RpwSettingsDefaults } from "./shared/rpw_types"
import { Project, Module, SourceFile } from "./asm/project"
import { Node, NodeErrorType, Token, TokenType } from "./asm/tokenizer"
import { Expression, FileNameExpression, SymbolExpression, NumberExpression } from "./asm/expressions"
import { Statement, OpStatement } from "./asm/statements"
import { SymbolType } from "./asm/symbols"
import { renumberLocals, renameSymbol } from "./asm/labels"
import { Completions, getCommentHeader } from "./lsp_utils"
import { SyntaxNames } from "./asm/syntaxes/syntax_types"
import { OpcodeDef, OpMode, isaSet65xx } from "./isa65xx"

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
  type      = 8,

  function  = 9,
  buffer    = 10,
  opcode    = 11,
  constant  = 12,
  zpage     = 13,
  var       = 14,
  escape    = 15,
}

export enum SemanticModifier {
  local     = 0,
  global    = 1,      // TODO: make use of this?
  external  = 2
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

class LspProject extends Project {

  private server: LspServer

  constructor(server: LspServer, defaultSettings: RpwSettings) {
    super(defaultSettings)
    this.server = server
  }

  getFileContents(fullPath: string): string | undefined {
    // look through open documents first
    const uri = uriFromPath(fullPath)
    const document = this.server.documents.get(uri)
    if (document) {
      return document.getText()
    }
    // if no open document, go look in file system
    return super.getFileContents(fullPath)
  }

  openSourceFile(module: Module, fullPath: string): SourceFile | undefined {
    this.server.removeTemporary(this, fullPath)
    return super.openSourceFile(module, fullPath)
  }
}

//------------------------------------------------------------------------------

type SemanticState = {
  prevLine: number
  prevStart: number
  startOffset: number
  endOffset: number
  data: number[]
}

type DiagnosticState = {
  sourceFile: SourceFile
  lineNumber: number
  startOffset: number
  endOffset: number
  diagnostics: lsp.Diagnostic[]
}

export class LspServer {

  private connection: lsp.Connection
  /*private*/ documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument)

  private isInitialized: Promise<boolean>
  private isInitialized_resolve: any

  private projects: LspProject[] = []

  public workspaceFolderPath = ""
  private rpwProject?: RpwProject

  private updateId?: NodeJS.Timeout
  private updateFile?: SourceFile
  private diagnosticId?: NodeJS.Timeout
  private defaultSettings?: Promise<RpwSettings>
  private showErrors = true
  private showWarnings = true

  constructor(connection: lsp.Connection) {
    this.connection = connection
    this.documents.listen(this.connection)

    this.isInitialized = new Promise<boolean>((resolve) => {
      this.isInitialized_resolve = resolve
    })

    this.documents.onDidOpen(e => {
      this.onDidOpenTextDocument(e.document.uri)
    })

    this.documents.onDidChangeContent(e => {
      this.onDidChangeTextDocument(e.document.uri)
    })

    this.documents.onDidClose(e => {
      this.onDidCloseTextDocument(e.document.uri)
    })

    this.connection.onDidChangeConfiguration(e => {
      this.onDidChangeConfiguration()
    })

    this.connection.onInitialize(this.onInitialize.bind(this))
    this.connection.onInitialized(this.onInitialized.bind(this))
    this.connection.onCompletion(this.onCompletion.bind(this))
    this.connection.onCompletionResolve(this.onCompletionResolve.bind(this))
    this.connection.onDefinition(this.onDefinition.bind(this))
    this.connection.onExecuteCommand(this.onExecuteCommand.bind(this))
    this.connection.onFoldingRanges(this.onFoldingRanges.bind(this))
    this.connection.onHover(this.onHover.bind(this))
    this.connection.onReferences(this.onReferences.bind(this))
    this.connection.onPrepareRename(this.onPrepareRename.bind(this))
    this.connection.onRenameRequest(this.onRename.bind(this))
    this.connection.languages.semanticTokens.on(this.onSemanticTokensFull.bind(this))
    this.connection.languages.semanticTokens.onRange(this.onSemanticTokensRange.bind(this))
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
      const statement = sourceFile.statements[lineNumber]
      if (statement && statement.enabled) {
        return statement
      }
    }
  }

  // if a file was opened in a project,
  //  remove a temporary project that already owned the file
  removeTemporary(curProject: Project, filePath: string) {
    for (let project of this.projects) {
      if (project != curProject && project.isTemporary) {
        if (project.findSourceFile(filePath)) {
          // only remove if it's alone in its project/module
          // NOTE: for now, just disable the project by removing its modules
          // Removing it completely will cause problems because caller is
          //  iterating through list of projects.
          project.modules = []
          break
        }
      }
    }
  }

  // TODO: just use a map lookup directly?
  findSourceFile(filePath: string): SourceFile | undefined {
    for (let project of this.projects) {
      const sourceFile = project.findSourceFile(filePath)
      if (sourceFile) {
        return sourceFile
      }
    }
  }

  onInitialize(params: lsp.InitializeParams): lsp.InitializeResult {

    // TODO: enable this for debugging immediately after initialize
    // const n = 1
    // while (n) {
    //   console.log()
    // }

    const result: lsp.InitializeResult = {
      capabilities: {
        textDocumentSync: lsp.TextDocumentSyncKind.Incremental,
        completionProvider: {
          // *** TODO: make this syntax-specific
          triggerCharacters: ["(", ":", ".", "+", "!"],
          resolveProvider: true
        },
        definitionProvider: true,
        hoverProvider: true,
        renameProvider: { prepareProvider: true },
        referencesProvider: true,
        foldingRangeProvider: true
      }
    }

    result.capabilities.workspace = {
      workspaceFolders: {
        supported: true
      }
    }

    // NOTE: keep in sync with enum SemanticToken above
    result.capabilities.semanticTokensProvider = {
      documentSelector: ['rpw65'],
      legend: {
        tokenTypes: [
          "invalid",   // 0
          "comment",   // 1
          "string",    // 2
          "number",    // 3
          "operator",  // 4
          "keyword",   // 5
          "label",     // 6
          "macro",     // 7
          "type",      // 8

          "function",  // 9
          "buffer",    // 10
          "opcode",    // 11
          "constant",  // 12
          "zpage",     // 13
          "var",       // 14
          "escape",    // 15
        ],
        tokenModifiers: [
          "local",
          "global",
          "external"
        ],
      },
      full: true,
      range: true
    }

    if (params.workspaceFolders) {

      // TODO: walk each folder or don't support multiple folders

      const workspaceFolder = params.workspaceFolders[0]
      const folderPath = pathFromUriString(workspaceFolder.uri) || ""
      if (fs.existsSync(folderPath)) {

        // save folder once it's know to exist
        this.workspaceFolderPath = folderPath
        const files = fs.readdirSync(this.workspaceFolderPath)

        // first scan for .rpw-project file
        let project: LspProject | undefined
        for (let file of files) {
          if (file.toLowerCase().indexOf(".rpw-project") == -1) {
            continue
          }

          if (project) {
            throw new Error("Multiple .rpw-project files found")
          }

          const jsonData = fs.readFileSync(file, 'utf8')
          try {
            this.rpwProject = <RpwProject>JSON.parse(jsonData)
          } catch (e: any) {
            throw new Error("Failed to parse project JSON: " + e.toString())
          }
        }
      }

      // *** change trigger character after project parsed ***
    }

    return result
  }

  private async onInitialized() {

    if (this.rpwProject) {

      if (!this.defaultSettings) {
        this.defaultSettings = this.buildRpwSettings()
      }

      const project = new LspProject(this, await this.defaultSettings)
      if (!project.loadProject(this.workspaceFolderPath, this.rpwProject)) {
        throw new Error("Failed to load project")
      }
      this.projects.push(project)
    }

    // if no project, scan for ASM.* files
    // if (this.projects.length == 0) {
    //   const files = fs.readdirSync(this.workspaceFolderPath)
    //   for (let i = 0; i < files.length; i += 1) {
    //     if (files[i].toUpperCase().indexOf("ASM.") != 0) {
    //       continue
    //     }
    //     if (!this.addFileProject(files[i], false)) {
    //       // TODO: error handling
    //     }
    //     break
    //   }
    // }

    this.isInitialized_resolve(true)

    // register for all configuration changes
    this.connection.client.register(DidChangeConfigurationNotification.type, undefined)

    // this.connection.workspace.onDidChangeWorkspaceFolders(e => {
    //   this.connection.console.log('Workspace folder change event received.')
    // })

    // send this so client will ask for initial syntax
    this.connection.sendNotification("rpw.syntaxChanged")

    this.scheduleUpdate()
  }

  private async onDidChangeConfiguration() {
    this.defaultSettings = this.buildRpwSettings()

    for (let project of this.projects) {
      project.settingsChanged(await this.defaultSettings)
    }

    this.scheduleUpdate()

    // send this so client will ask for syntax
    this.connection.sendNotification("rpw.syntaxChanged")
  }

  // TODO: need fallback if vscode client not present
  private async buildRpwSettings(): Promise<RpwSettings> {
    const econfig = await this.connection.workspace.getConfiguration("editor")
    const tabSize = econfig.tabSize ?? 4
    const config = await this.connection.workspace.getConfiguration("rpw65")
    this.showErrors = config.showErrors ?? true
    this.showWarnings = config.showWarnings ?? true
    const syntax = config.syntax  // no default
    const lowerCase = config.case?.lowerCaseCompletions ?? false
    const upperCase = !lowerCase
    // TODO: could also use "editor.rulers"
    const c1 = config.columns?.c1 ?? 16
    const c2 = config.columns?.c2 ?? 4
    const c3 = config.columns?.c3 ?? 20
    const tabStops = [0, c1, c1 + c2, c1 + c2 + c3]
    return { syntax, upperCase, tabSize, tabStops }
  }

  private scheduleUpdate(sourceFile?: SourceFile) {
    if (this.updateId !== undefined) {
      clearTimeout(this.updateId)
    }
    const updateTimeout = 1
    this.updateFile = sourceFile
    this.updateId = setTimeout(() => { this.executeUpdate() }, updateTimeout)
  }

  // only executes if previously scheduled
  private executeUpdate() {
    if (this.updateId !== undefined) {

      clearTimeout(this.updateId)
      delete this.updateId

      for (let project of this.projects) {
        project.update()
      }

      // *** okay to always to this? or only on actual change? ***
      this.connection.sendNotification("rpw.syntaxChanged")

      this.scheduleDiagnostics(this.updateFile)
      delete this.updateFile
    }
  }

  private scheduleDiagnostics(priorityFile?: SourceFile) {
    if (this.diagnosticId !== undefined) {
      clearTimeout(this.diagnosticId)
    }
    const diagnosticTimeout = 500
    this.diagnosticId = setTimeout(() => { this.executeDiagnostics(priorityFile) }, diagnosticTimeout)
  }

  private executeDiagnostics(priorityFile?: SourceFile) {
    if (this.diagnosticId !== undefined) {

      clearTimeout(this.diagnosticId)
      delete this.diagnosticId

      if (priorityFile) {
        this.updateDiagnostics(priorityFile)
      }

      for (let project of this.projects) {
        for (let module of project.modules) {
          // NOTE: This will update shared files multiple times
          for (let sourceFile of module.sourceFiles) {
            if (sourceFile != priorityFile) {
              this.updateDiagnostics(sourceFile)
            }
          }
        }
      }

      // *** send message that semantic tokens need refresh ***
      // this.connection.sendNotification("workspace/semanticTokens/refresh")
    }
  }

  // build a tempory project given a file path
  private async addFileProject(path: string): Promise<LspProject | undefined> {
    let fileName: string
    let directory: string
    let inWorkspace: boolean
    if (path.indexOf(this.workspaceFolderPath) == 0) {
      inWorkspace = true
      fileName = path.substring(this.workspaceFolderPath.length + 1)
      directory = this.workspaceFolderPath
    } else {
      inWorkspace = false
      const index = path.lastIndexOf("/")
      if (index == -1) {
        fileName = path
        directory = "."
      } else {
        fileName = path.substring(index + 1)
        directory = path.substring(0, index)
      }
    }

    // build a fake project file
    const rpwProject: RpwProject = {}
    rpwProject.modules = []
    rpwProject.modules.push({src: fileName})

    if (!this.defaultSettings) {
      this.defaultSettings = this.buildRpwSettings()
    }

    const project = new LspProject(this, await this.defaultSettings)
    const isTemporary = true
    project.loadProject(directory, rpwProject, isTemporary, inWorkspace)
    this.projects.push(project)
    return project
  }

  async onDidOpenTextDocument(uri: string) {

    // Don't process documents opening until project load has completed,
    //  otherwise, temporary projects get created for files that will
    //  eventually be part of the main project.
    //
    // TODO: why does the project load not correct consume these
    //  temporary projects as the files are identified?
    await this.isInitialized

    this.executeUpdate()

    const filePath = pathFromUriString(uri)
    if (filePath) {
      let sourceFile = this.findSourceFile(filePath)
      if (!sourceFile) {
        const project = await this.addFileProject(filePath)
        if (!project) {
          // *** error handling ***
          return
        }
        this.scheduleUpdate(sourceFile)
      }
      this.connection.sendNotification("rpw.syntaxChanged")
    }
  }

  onDidCloseTextDocument(uri: string): void {
    const filePath = pathFromUriString(uri)
    if (filePath) {
      let sourceFile = this.findSourceFile(filePath)
      if (sourceFile) {
        const project = sourceFile.project as LspProject
        if (project && project.isTemporary) {
          this.removeDiagnostics(sourceFile)
          const index = this.projects.indexOf(project)
          this.projects.splice(index, 1)
        }
      }
    }
  }

  // NOTE: This gets called by VSCode in cases where the actual
  //  contents of a file have not changed -- when it's first opened,
  //  or when clicking through the files of a project where they
  //  are shown in the same italicized/quick file tab.
  // For performance purposes, it may be worth scanning the file
  //  contents against known to contents to check for differences.
  onDidChangeTextDocument(uri: string): void {
    const filePath = pathFromUriString(uri)
    if (filePath) {
      const sourceFile = this.findSourceFile(filePath)
      if (sourceFile) {
        this.scheduleUpdate(sourceFile)
      }
    }
  }

  async onCompletion(params: lsp.CompletionParams, cancelToken?: lsp.CancellationToken): Promise<lsp.CompletionList | null> {
    this.executeUpdate()

    let sourceFile: SourceFile | undefined
    let statement: Statement | undefined

    const filePath = pathFromUriString(params.textDocument.uri)
    if (filePath) {
      sourceFile = this.findSourceFile(filePath)
      if (sourceFile) {
        const s = sourceFile.statements[params.position.line]
        if (s && s.enabled) {
          statement = s
        }
      }
    }
    if (!sourceFile || !statement) {
      return lsp.CompletionList.create([], false)
    }

    const comp = new Completions()
    let completions = comp.scan(sourceFile, params.position.line, params.position.character)
    if (!completions) {
      // return a fake completion that will prevent default suggestions
      let item = lsp.CompletionItem.create("")
      item.kind = lsp.CompletionItemKind.Text
      completions = [item]
    }
    const isIncomplete = false
    return lsp.CompletionList.create(completions, isIncomplete)
  }

  async onCompletionResolve(item: lsp.CompletionItem, token?: lsp.CancellationToken): Promise<lsp.CompletionItem> {
    return Completions.resolve(this, item)
  }

  async onExecuteCommand(params: lsp.ExecuteCommandParams, token?: lsp.CancellationToken, workDoneProgress?: lsp.WorkDoneProgressReporter): Promise<any> {

    if (params.arguments === undefined || params.arguments.length == 0) {
      return
    }

    const filePath = pathFromUriString(params.arguments[0])
    if (!filePath) {
      return
    }

    const textDocument = this.documents.get(params.arguments[0])
    if (textDocument === undefined) {
      return
    }

    const sourceFile = this.findSourceFile(filePath)
    if (!sourceFile) {
      return
    }

    if (params.command == "rpw65.renumberLocals") {

      this.executeUpdate()

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

    } else if (params.command == "rpw65.getSyntax") {

      this.executeUpdate()

      let syntax = SyntaxNames[sourceFile.project.syntax]
      if (syntax) {
        const syntaxes: string[] = []
        syntax = syntax.toUpperCase()
        for (let name of SyntaxNames) {
          syntaxes.push(name.toUpperCase())
        }
        return { syntax, syntaxes }
      }

    }
  }

  async onFoldingRanges(params: lsp.FoldingRangeParams, token?: lsp.CancellationToken): Promise<lsp.FoldingRange[] | undefined> {
    this.executeUpdate()

    const foldingRanges: lsp.FoldingRange[] = []
    let sourceFile = this.getSourceFile(params.textDocument.uri)
    if (sourceFile) {
      for (let statement of sourceFile.statements) {
        if (statement.enabled) {
          if (statement.foldEnd && sourceFile) {
            const startLine = sourceFile.statements.indexOf(statement)
            const endLine = sourceFile.statements.indexOf(statement.foldEnd) - 1
            if (startLine < endLine) {
              const range: lsp.FoldingRange = {
                startLine, endLine
              }
              foldingRanges.push(range)
            }
          }
        }
      }
    }
    return foldingRanges
  }

  async onHover(params: lsp.TextDocumentPositionParams, token?: lsp.CancellationToken): Promise<lsp.Hover> {
    this.executeUpdate()

    let hoverStr = ""
    const statement = this.getStatement(params.textDocument.uri, params.position.line)
    if (statement) {
      const res = statement.findExpressionAt(params.position.character)
      if (res) {
        if (res.expression instanceof SymbolExpression) {
          const hoverExp = res.expression
          // TODO: if hovering over macro invocation, show macro contents
          if (hoverExp instanceof SymbolExpression) {
            if (hoverExp.symbol) {
              const defExp = hoverExp.symbol.definition
              if (defExp && defExp.sourceFile) {
                hoverStr = getCommentHeader(defExp.sourceFile, defExp.lineNumber) ?? ""
                if (hoverExp.symbol.isConstant) {
                  const value = hoverExp.resolve()
                  if (value != undefined) {
                    hoverStr += hoverExp.getSimpleName().asString
                      + " = " + value.toString(10)
                      + ", $" + value.toString(16).padStart(2, "0").toUpperCase()
                      + ", %" + value.toString(2).padStart(8, "0")
                  }
                } else if (hoverExp.symbol.isZPage) {
                  const value = hoverExp.resolve()
                  if (value != undefined) {
                    hoverStr += hoverExp.getSimpleName().asString
                      + " = $" + value.toString(16).padStart(2, "0").toUpperCase()
                  }
                }
              }
            }
          }
        } else if (res.expression instanceof NumberExpression) {
          const value = res.expression.resolve()
          if (value != undefined) {
            hoverStr += value.toString(10)
              + ", $" + value.toString(16).padStart(2, "0").toUpperCase()
              + ", %" + value.toString(2).padStart(8, "0")
          }
        } else if (statement instanceof OpStatement) {
          if (res.expression == statement.opExp) {
            const opName = res.expression.getString()
            const opNameLC = opName.toLowerCase()
            const upperCase = (opName != opNameLC)
            let opMatches: OpcodeDef[] = []

            // TODO: how should this be chosen? get from statement?
            // TODO: mechanism to enable 65c02 and 65816
            const isa = isaSet65xx.getIsa("65816")

            const opType = isa.opcodeByName.get(opNameLC)
            opType?.forEach((value, key) => {
              opMatches.push(value)
            })

            // add opcode description
            hoverStr += isa.getDescByName(opNameLC) ?? ""

            if (opMatches.length > 0) {

              // add status flags affected
              const flags = opMatches[0].sf
              let affected = ""
              if (flags) {
                affected = flags.toUpperCase()
              } else {
                affected = "none"
              }
              hoverStr += "\nAffects: " + affected + "\n"

              // sort opMatches by addressing mode

              opMatches.sort((a, b): number => {
                if (a.mode < b.mode) {
                  return -1
                }
                if (a.mode > b.mode) {
                  return 1
                }
                return 0
              })

              for (let opEntry of opMatches) {

                // data bytes
                let lineStr = opEntry.val.toString(16).padStart(2, "0").toUpperCase()
                if (opEntry.bc == 2) {
                  lineStr += " 12"
                } else if (opEntry.bc == 3) {
                  lineStr += " 34 12"
                } else if (opEntry.bc == 4) {
                  lineStr += " 56 34 12 "
                }

                lineStr = lineStr.padEnd(10, "\xA0")

                // opcode
                lineStr += (upperCase ? opEntry.name.toUpperCase() : opEntry.name) + " "

                // addressing mode expression, if any
                let opExp = ""
                if (opEntry.bc == 2) {
                  opExp = "$12"
                } else if (opEntry.bc == 3) {
                  opExp = "$1234"
                } else if (opEntry.bc == 4) {
                  opExp = "$123456"
                }

                switch (opEntry.mode) {
                  case OpMode.NONE:     //
                  case OpMode.A:        // a
                    break
                  case OpMode.IMM:      // #$FF
                    lineStr += "#" + opExp
                    break
                  case OpMode.ZP:       // $FF
                  case OpMode.ABS:      // $FFFF
                  case OpMode.LABS:     // $FFFFFF
                    lineStr += opExp
                    break
                  case OpMode.ZPX:      // $FF,X
                  case OpMode.ABSX:     // $FFFF,X
                  case OpMode.LABX:     // $FFFFFF,X
                    lineStr += opExp + (upperCase ? ",X" : ",x")
                    break
                  case OpMode.ZPY:      // $FF,Y
                  case OpMode.ABSY:     // $FFFF,Y
                    lineStr += opExp + (upperCase ? ",Y" : ",y")
                    break
                  case OpMode.INDX:     // ($FF,X)
                  case OpMode.AXI:      // ($FFFF,X)
                    lineStr += "(" + opExp + (upperCase ? ",X)" : ",x)")
                    break
                  case OpMode.INDY:     // ($FF),Y
                    lineStr += "(" + opExp + (upperCase ? "),Y" : "),y")
                    break
                  case OpMode.REL:      // *+-$FF
                  case OpMode.LREL:     // *+-$FFFF
                    lineStr += "*+-" + opExp
                    break
                  case OpMode.INZ:      // ($FF)
                  case OpMode.IND:      // ($FFFF)
                    lineStr += "(" + opExp + ")"
                    break
                  case OpMode.LIY:      // [$FF],Y
                    lineStr += "[" + opExp + (upperCase ? "],Y" : "],y")
                    break
                  case OpMode.LIN:      // [$FF]
                  case OpMode.ALI:      // [$FFFF]
                    lineStr += "[" + opExp + "]"
                    break
                  case OpMode.STS:      // stack,S
                    lineStr += opExp + (upperCase ? ",S" : ",s")
                    break
                  case OpMode.SIY:      // (stack,S),Y
                    lineStr += "(" + opExp + (upperCase ? ",S),Y" : ",s),y")
                    break
                  case OpMode.SD:       // #$FF,#$FF
                    // TODO:
                    break

                  // 65EL02-only
                  case OpMode.STS:      // stack,R
                    lineStr += opExp + (upperCase ? ",R" : ",r")
                    break
                  case OpMode.SIY:      // (stack,R),Y
                    lineStr += "(" + opExp + (upperCase ? ",R),Y" : ",r),y")
                    break
                }

                lineStr = lineStr.padEnd(22, "\xA0")

                // cycle count
                if (opEntry.cy) {
                  lineStr += " ; " + opEntry.cy
                }

                hoverStr += lineStr + "\n"
              }
            }
          }
        } else if (statement.keywordDef) {
          const desc = statement.keywordDef.desc ?? ""
          if (desc != "") {
            hoverStr += desc + "\n"
          }
          if (statement.keywordDef.label && statement.keywordDef.label[0] == "<") {
            hoverStr += "<label> "
          }
          hoverStr += statement.opExp?.getString() + " " + (statement.keywordDef.params ?? "")
        }
      }
    }

    if (hoverStr != "") {
      hoverStr = "```\n" + hoverStr + "\n```"
      return { contents: hoverStr }
    }
    return { contents: [] }
  }

  async onDefinition(params: lsp.DefinitionParams, token?: lsp.CancellationToken): Promise<lsp.Definition | lsp.DefinitionLink[] | undefined> {
    this.executeUpdate()

    const statement = this.getStatement(params.textDocument.uri, params.position.line)
    if (statement) {
      const res = statement.findExpressionAt(params.position.character)
      // TODO: support include/PUT files
      if (res && res.expression instanceof SymbolExpression) {
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

  async onReferences(params: lsp.ReferenceParams, token?: lsp.CancellationToken): Promise<lsp.Location[]> {
    this.executeUpdate()

    const locations: lsp.Location[] = []
    const statement = this.getStatement(params.textDocument.uri, params.position.line)
    if (statement) {
      const res = statement.findExpressionAt(params.position.character)
      if (res && res.expression instanceof SymbolExpression) {
        const symbol = res.expression.symbol
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
    }
    return locations
  }

  async onPrepareRename(params: lsp.PrepareRenameParams, token?: lsp.CancellationToken): Promise<lsp.Range | { range: lsp.Range; placeholder: string; } | undefined | null> {
    this.executeUpdate()

    const statement = this.getStatement(params.textDocument.uri, params.position.line)
    if (statement) {
      const res = statement.findExpressionAt(params.position.character)
      if (res && res.expression instanceof SymbolExpression) {
        const symExp = res.expression
        let symbol = symExp.symbol
        if (symbol) {
          const simpleName = symExp.getSimpleName()
          if (simpleName.asToken) {
            let range: lsp.Range = {
              start: { line: symExp.lineNumber, character: simpleName.asToken.start },
              end: { line: symExp.lineNumber, character: simpleName.asToken.end }
            }
            return { range, placeholder: simpleName.asString }
          }
        }
      }
    }
  }

  async onRename(params: lsp.RenameParams, token?: lsp.CancellationToken): Promise<lsp.WorkspaceEdit | undefined | null> {
    this.executeUpdate()

    const statement = this.getStatement(params.textDocument.uri, params.position.line)
    if (statement) {
      const res = statement.findExpressionAt(params.position.character)
      if (res && res.expression instanceof SymbolExpression) {
        const symExp = res.expression
        let symbol = symExp.symbol
        if (symbol) {
          // TODO: make sure new name won't cause duplicate label problems
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

  //----------------------------------------------------------------------------

  private removeDiagnostics(sourceFile: SourceFile) {
    // reschedule, just in case sourceFile is current priority file
    this.scheduleDiagnostics()

    this.connection.sendDiagnostics({
      uri: URI.file(sourceFile.fullPath).toString(),
      diagnostics: [] })
  }

  private updateDiagnostics(sourceFile: SourceFile) {

    const diagnostics: lsp.Diagnostic[] = []
    const state: DiagnosticState = { sourceFile, lineNumber: 0, startOffset: 0, endOffset: 0, diagnostics }

    for (let lineNumber = 0; lineNumber < sourceFile.statements.length; ) {

      const statement = sourceFile.statements[lineNumber]

      // collect diabled lines into a single DiagnosticTag.Unnecessary range
      if (!statement.enabled) {
        let endLine = lineNumber
        while (++endLine < sourceFile.statements.length) {
          if (sourceFile.statements[endLine].enabled) {
            break
          }
        }
        const range = lsp.Range.create(lineNumber, 0, endLine, 0)
        const diag = lsp.Diagnostic.create(range, "Disabled by conditional")
        diag.tags = [lsp.DiagnosticTag.Unnecessary]
        diag.severity = lsp.DiagnosticSeverity.Hint
        diagnostics.push(diag)
        lineNumber = endLine
        continue
      }

      state.lineNumber = lineNumber
      state.startOffset = statement.startOffset ?? 0
      state.endOffset = statement.endOffset ?? statement.sourceLine.length
      this.diagnoseExpression(state, statement)
      lineNumber += 1
    }

    this.connection.sendDiagnostics({
      uri: URI.file(sourceFile.fullPath).toString(),
      diagnostics: diagnostics })
  }

  private diagnoseExpression(state: DiagnosticState, expression: Expression) {

    // mark unused symbols as DiagnosticTag.Unnecessary
    if (expression instanceof SymbolExpression) {
      // TODO: track variable references
      if (expression.isDefinition && !expression.isVariableType()) {
        const symbol = expression.symbol
        if (symbol && symbol.references.length == 0) {
          const expRange = expression.getRange()
          if (expRange && expRange.start >= state.startOffset && expRange.end <= state.endOffset) {
            const diagRange = lsp.Range.create(
              state.lineNumber, expRange.start - state.startOffset, state.lineNumber, expRange.end - state.startOffset)
            const diag = lsp.Diagnostic.create(diagRange, "Unreferenced label")
            diag.tags = [lsp.DiagnosticTag.Unnecessary]
            diag.severity = lsp.DiagnosticSeverity.Hint
            state.diagnostics.push(diag)
            // fall through in case children have errors
          }
        }
      }

      // TODO: for any duplicate symbol, add information link back to definition

    } else if (expression instanceof FileNameExpression) {
      if (expression.hasAnyError()) {
        const expRange = expression.getRange()
        if (expRange && expRange.start >= state.startOffset && expRange.end <= state.endOffset) {
          let diagRange: lsp.Range
          let hint: boolean
          if (state.sourceFile.project.isTemporary) {
            // dim out the entire line, including put/include
            hint = true
            diagRange = lsp.Range.create(
              state.lineNumber, 0, state.lineNumber, expRange.end - state.startOffset)
          } else {
            // error underline just the file name
            hint = false
            diagRange = lsp.Range.create(
              state.lineNumber, expRange.start - state.startOffset, state.lineNumber, expRange.end - state.startOffset)
          }
          const diag = lsp.Diagnostic.create(diagRange, "File not found")
          diag.severity = hint ? lsp.DiagnosticSeverity.Hint : lsp.DiagnosticSeverity.Error
          diag.tags = hint ? [lsp.DiagnosticTag.Unnecessary] : []
          state.diagnostics.push(diag)
          return true
        }
      }
    }

    if (expression.errorType != NodeErrorType.None) {
      this.diagnoseNode(state, expression)
    }

    for (let i = 0; i < expression.children.length; i += 1) {
      const node = expression.children[i]
      if (node instanceof Expression) {
        this.diagnoseExpression(state, node)
      } else {
        if (this.diagnoseNode(state, node)) {
          return
        }
      }
    }
  }

  private diagnoseNode(state: DiagnosticState, node: Node): boolean {
    const includeWeak = !state.sourceFile.project.isTemporary
    if (node.errorType != NodeErrorType.None) {
      let severity: lsp.DiagnosticSeverity
      switch (node.errorType) {
        case NodeErrorType.ErrorWeak:
          if (!includeWeak) {
            return false
          }
          // fall through
        default:
        case NodeErrorType.Error:
          if (!this.showErrors) {
            return false
          }
          severity = lsp.DiagnosticSeverity.Error       // red line
          break
        case NodeErrorType.Warning:
          if (!this.showWarnings) {
            return false
          }
          severity = lsp.DiagnosticSeverity.Warning     // yellow line
          break
        case NodeErrorType.Info:
          severity = lsp.DiagnosticSeverity.Information // blue line
          break
      }

      const nodeRange = node.getRange()
      if (nodeRange) {
        if (nodeRange.start >= state.startOffset && nodeRange.end <= state.endOffset) {
          const diagRange = lsp.Range.create(
            state.lineNumber, nodeRange.start - state.startOffset,
            state.lineNumber, Math.max(nodeRange.end, nodeRange.start + 1) - state.startOffset
          )
          const diag = lsp.Diagnostic.create(diagRange, node.errorMessage ?? "", severity)
          state.diagnostics.push(diag)
        }
      }
    }
    return node.errorType == NodeErrorType.Error ||
           (node.errorType == NodeErrorType.ErrorWeak && includeWeak)
  }

  //----------------------------------------------------------------------------

  async onSemanticTokensFull(params: lsp.SemanticTokensParams, token?: lsp.CancellationToken): Promise<lsp.SemanticTokens> {
    this.executeUpdate()

    const sourceFile = this.getSourceFile(params.textDocument.uri)
    if (sourceFile) {
      return this.getSemanticTokens(sourceFile, 0, sourceFile.statements.length)
    } else {
      return { data: [] }
    }
  }

  async onSemanticTokensRange(params: lsp.SemanticTokensRangeParams, token?: lsp.CancellationToken): Promise<lsp.SemanticTokens> {
    this.executeUpdate()

    const sourceFile = this.getSourceFile(params.textDocument.uri)
    if (sourceFile) {
      return this.getSemanticTokens(sourceFile, params.range.start.line, params.range.end.line)
    } else {
      return { data: [] }
    }
  }

  private getSemanticTokens(sourceFile: SourceFile, startLine: number, endLine: number): lsp.SemanticTokens {
    const data: number[] = []
    const state: SemanticState = { prevLine: 0, prevStart: 0, startOffset: 0, endOffset: 0, data: data }
    for (let i = startLine; i < endLine; i += 1) {
      let statement = sourceFile.statements[i]
      if (statement.enabled) {
        state.prevStart = 0
        state.startOffset = statement.startOffset ?? 0
        state.endOffset = statement.endOffset ?? statement.sourceLine.length
        this.semanticExpression(state, i, statement)
      }
    }
    return { data }
  }

  private semanticExpression(state: SemanticState, lineNumber: number, expression: Expression) {
    if (expression instanceof SymbolExpression) {
      const symExp = expression
      for (let i = 0; i < symExp.children.length; i += 1) {
        const token = symExp.children[i]
        const range = token.getRange()
        if (range) {
          // NOTE: using range.start instead of range.end
          //  to protect against token overlapping range
          if (range.start < state.startOffset) {
            continue
          }
          if (range.start >= state.endOffset) {
            break
          }
        }
        if (token instanceof Token) {
          // *** TODO: use semanticToken() instead of duplicate code?
          // *** get rid of Symbol check? ***
          if (token.type == TokenType.Label || token.type == TokenType.Symbol) {
            let index = SemanticToken.invalid
            let bits = 0
            // check for variable before local because some locals are mutable
            if (symExp.isVariableType() ||
                symExp.symbolType == SymbolType.NamedParam ||
                symExp.symbol?.isMutable) {
              index = SemanticToken.var
            } else if (symExp.isLocalType()) {
              index = SemanticToken.label
              bits |= (1 << SemanticModifier.local)
            } else if (symExp.symbol) {
              if (symExp.symbol.type == SymbolType.MacroName ||
                  symExp.symbol.type == SymbolType.TypeName) {
                index = SemanticToken.macro
              } else if (symExp.symbol.isZPage) {
                index = SemanticToken.zpage
              } else if (symExp.symbol.isConstant) {
                index = SemanticToken.constant
              } else if (symExp.symbol.isSubroutine) {
                // *** maybe skip for locals? ***
                index = SemanticToken.function
              } else if (symExp.symbol.isData) {
                index = SemanticToken.buffer
              } else if (symExp.symbol.isCode) {
                index = SemanticToken.label
              }
              if (symExp.symbol.isExport()) {
                index = SemanticToken.function    //*** only if still symbol?
                bits |= (1 << SemanticModifier.external)
              }
            } else {
              // TODO: what if label doesn't have symbol?
              //  (assume it's already been marked with an error?)
              continue
            }
            if (index == SemanticToken.invalid) {   // ***
              continue
            }
            state.data.push(lineNumber - state.prevLine, token.start - state.startOffset - state.prevStart, token.length, index, bits)
            state.prevStart = token.start - state.startOffset
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
        } else if (child instanceof Expression) {
          this.semanticExpression(state, lineNumber, child)
        }
      }
    }
  }

  private semanticToken(state: SemanticState, lineNumber: number, token: Token) {
    const range = token.getRange()
    if (range) {
      // NOTE: using range.start instead of range.end
      //  to protect against token overlapping range
      if (range.start < state.startOffset) {
        return
      }
      if (range.start >= state.endOffset) {
        return
      }
    }
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
    } else if (token.type == TokenType.TypeName) {
      index = SemanticToken.type
    } else {
      index = SemanticToken.invalid
    }
    if (index >= 0) {
      state.data.push(lineNumber - state.prevLine, token.start - state.startOffset - state.prevStart, token.length, index, bits)
      state.prevStart = token.start - state.startOffset
      state.prevLine = lineNumber
    }
  }

  //----------------------------------------------------------------------------
}

//------------------------------------------------------------------------------
