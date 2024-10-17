
// MERLIN
  // label starts in first column
  // locals start with ':'
  // no operator precedence (left to right)
// DASM
  // scoped with SUBROUTINE
  // locals start with '.'
// ACME
  // keywords start with '!'
  // locals scoped with !zone
  // locals start with '.' or '@'
    // '.' scoped to !zone, '@' scoped to previous global
  // locals of '+++' and '---'
  // symbol names are case sensitive
  // {} groups
  // does not allow "LSR A" -- just "LSR"
  // has operator precendence
  // +/- branches
  // +name to invoke macro
  // '.' and '#' in binary values
  // indented everything (labels)
  // *=$9999 to set org (any column)
// CA65
  // keywords start with '.'
  // label starts in first column, ends with ':'
    // trailing ':' requirement turned off with feature
  // locals scoped with .PROC
  // locals start with '@'
    // scoped to previous non-local
    // changable using .LOCALCHAR
  // locals of ':+++' and ':---' -> ':' label
  // has named scopes, using ':', '::' for global scope
    // .SCOPE applies to non-local labels
    // .PROC is an implicit scope
// LISA
  // locals start with '^' followed by 0-9
    // scoped globally and repeatedly
    // <# and ># to reference
// SBASM
  // label always at position 0
  // keywords start with '.'
  // trailing ':' on labels is optional
  // label name should be followed by a white space or EOL
  // equates must resolve without forward references
  // local labels start with '.' and scoped to previous global
  // macro label start with ':'
  // global labels can contain '.'
  // scope other locals using GLOBAL:LOCAL name

//               MERLIN  DASM  CA65  ACME  LISA  SBASM
//  --------     ------  ----  ----  ----  ----  -----
//  !keyword                         ACME
//  .keyword                   CA65              SBASM
//  :local       MERLIN
//  :macrolocal                                  SBASM
//  .local               DASM        ACME        SBASM
//  @local                     CA65
//  label:                     CA65
//  +/-                              ACME
//  ^#,<#,>#                               LISA
//  +macro                           ACME

//               MERLIN  DASM  CA65  ACME  LISA  SBASM
//  --------     ------  ----  ----  ----  ----  -----
//  indented
//  assign         no    no    YES   YES   no    ???
//
//  *=$FFFF        no    no    ???   YES   no    ???
//
//  keywords
//  in col 0       no    ???   YES   ???   no    ???
//
//  .locals        no    YES   ???   ???   no    ???
//
//  .keywords      no    YES   ???   ???   no    ???

import { SourceFile } from "./project"
import { Node, Token, TokenType, Tokenizer } from "./tokenizer"
import { OpcodeSets } from "./opcodes"
import { Op, OpDef, SyntaxDef, Syntax, SyntaxMap, KeywordDef } from "./syntaxes/syntax_types"
import { SyntaxDefs } from "./syntaxes/syntax_defs"
import { SymbolType, SymbolFrom } from "./symbols"
import { ParamsParser } from "./syntaxes/params"
import * as exp from "./expressions"
import * as stm from "./statements"

//------------------------------------------------------------------------------

export class Parser extends Tokenizer {

  // valid for entire parseLines call
  public sourceFile: SourceFile | undefined
  public lineNumber: number = -1

  // valid during a single parseStatement call
  public nodeSet: Node[] = []
  public nodeSetStack: Node[][] = []
  public labelExp?: exp.SymbolExpression

  // TODO: configure these externally based on syntax and overrides
  public requireBrackets = false
  public allowBrackets = true

  private syntaxStats: number[] = []
  public paramsParser = new ParamsParser()

  // TODO: add requireTrailingColon, allowTrailingColon

  // push/pop the current expression to/from the expressionStack
  // *** move these ***

  public startExpression(token?: Token) {
    this.nodeSetStack.push(this.nodeSet)
    this.nodeSet = []
    if (token) {
      this.addToken(token)
    }
  }

  public endExpression(): Node[] {
    const result = this.nodeSet
    const prevSet = this.nodeSetStack.pop()
    // NOTE: don't pop the last set because that's the statement itself
    if (prevSet) {
      this.nodeSet = prevSet
    }
    return result
  }

  // push tokens and expression onto the current parent expression

  addToken(token: Token) {
    this.nodeSet.push(token)
  }

  mustAddNextToken(expectMsg: string): Token {
    const token = this.mustGetNextToken(expectMsg)
    this.addToken(token)
    return token
  }

  mustAddVeryNextToken(expectMsg: string): Token {
    const token = this.mustGetVeryNextToken(expectMsg)
    this.addToken(token)
    return token
  }

  addNextToken(): Token | undefined {
    const token = this.getNextToken()
    if (token) {
      this.addToken(token)
    }
    return token
  }

  addVeryNextToken(): Token | undefined {
    const token = this.getVeryNextToken()
    if (token) {
      this.addToken(token)
    }
    return token
  }

  // commit to a previously peeked token and then add it
  commitAddToken(peekToken: Token) {
    this.position = peekToken.end
    this.nodeSet.push(peekToken)
  }

  // Given a string or array of strings, attempt to parse and push
  //  a token matching one of them.  On success, return index of matching
  //  string.  On failure, push missing token and return -1.
  //  When matching an empty string, no token is pushed.

  mustAddToken(possible: string | string[], type?: TokenType): { index: number, token?: Token} {
    const strings = typeof possible == "string" ? [possible] : possible
    const token = this.addNextToken()
    const str = token?.getString().toLowerCase() ?? ""
    const index = strings.indexOf(str)
    if (index == -1) {
      let message = ""
      strings.forEach(str => {
        if (message.length > 0) {
          message += " or "
        }
        if (str == "") {
          message += "nothing"
        } else {
          message += "'" + str.toUpperCase() + "'"
        }
      })
      if (token) {
        token.setError("Unexpected token, expecting " + message)
      } else {
        this.addMissingToken("expecting " + message)
      }
    } else if (token && type != undefined) {
      token.type = type
    }
    return { index, token }
  }

  addMissingToken(message: string): Token {
    const token = this.createMissingToken()
    token.setError("Missing token, " + message)
    this.addToken(token)
    return token
  }

  createMissingToken(): Token {
    return new Token(this.sourceLine, this.position, this.position, TokenType.Missing)
  }

  addExpression(expression: exp.Expression) {
    this.nodeSet.push(expression)
  }

  mustAddNextExpression(token?: Token): exp.Expression {
    const expression = this.mustParseExpression(token)
    this.addExpression(expression)
    return expression
  }

  addNextExpression(token?: Token): exp.Expression | undefined {
    const expression = this.parseExpression(token)
    if (expression) {
      this.addExpression(expression)
    }
    return expression
  }

  public parseStatements(sourceFile: SourceFile, lines: string[], syntaxStats: number[]) {
    const statements = []
    this.sourceFile = sourceFile
    this.syntaxStats = syntaxStats
    this.lineNumber = 0
    this.syntax = sourceFile.module.project.syntax

    while (this.lineNumber < lines.length) {

      const sourceLine = lines[this.lineNumber]
      if (this.syntaxDef.allowLineContinuation) {
        if (sourceLine.endsWith("\\")) {
          this.parseContinuation(lines, statements)
          continue
        }
      }

      this.setSourceLine(sourceLine)
      statements.push(this.parseStatement())
      this.lineNumber += 1
    }
    return statements
  }

  private parseContinuation(lines: string[], statements: stm.Statement[]) {
    let n = this.lineNumber
    let combinedLine = ""
    const offsets: number[] = []

    let moreLines = true
    while (moreLines) {
      moreLines = lines[n].endsWith("\\")
      combinedLine += lines[n].substring(0, lines[n].length - (moreLines ? 1 : 0))
      offsets.push(combinedLine.length)
      n += 1
    }

    this.setSourceLine(combinedLine)
    const firstStatement = this.parseStatement()
    firstStatement.endOffset = lines[this.lineNumber++].length - 1
    firstStatement.sourceLine = combinedLine
    statements.push(firstStatement)
    // the first statement now contains the combined string with
    //  an endOffset set to the length of its original partial line

    let i = 0
    while (this.lineNumber < n) {
      const constStatement = new stm.ContinuedStatement(firstStatement, offsets[i], offsets[i + 1])
      constStatement.sourceLine = lines[this.lineNumber++]
      statements.push(constStatement)
      i += 1
    }
  }

  public reparseAsMacroInvoke(statement: stm.Statement, syntax: Syntax): stm.Statement | undefined {
    this.sourceFile = undefined
    this.syntaxStats = new Array(SyntaxDefs.length).fill(0)
    this.lineNumber = 0
    this.syntax = syntax
    this.setSourceLine(statement.sourceLine)
    const token = this.getNextToken()
    if (token) {
      return this.parseMacroInvoke(token)
    }
  }

  private parseStatement(): stm.Statement {

    this.nodeSet = []
    this.nodeSetStack = []
    this.labelExp = undefined
    let statement: stm.Statement | undefined

    // check for a comment first so Merlin's '*' comment special case gets handled
    this.pushNextComment()

    // check for keyword in the first column
    // TODO: this happens frequently -- could it be more efficient?
    if (this.syntaxDef.keywordsInColumn1) {
      const savedPosition = this.position
      const token = this.getNextToken()
      if (token) {
        statement = this.parseKeyword(token)
        if (!statement) {
          this.position = savedPosition
        }
      }
    }

    if (!statement) {
      // If syntax has macro invoke prefixes, check for that before
      //  a label in order disambiguate an anonymous local "+" from
      //  the start of "+my_macro" invoke in column 1, for example.
      if (this.syntaxDef.macroInvokePrefixes) {
        const savedPosition = this.position
        const token = this.getNextToken()
        if (token) {
          statement = this.parseMacroInvoke(token)
          if (!statement) {
            this.position = savedPosition
          }
        }
      }
    }

    if (!statement) {
      const symExp = this.parseSymbol(true)
      if (symExp) {
        this.addExpression(symExp)
        if (symExp instanceof exp.SymbolExpression) {
          this.labelExp = symExp
          if (symExp.isVariableType()) {
            // *** this is merlin-only ***
            const token = this.peekNextToken()
            if (token?.getString() == "=") {
              statement = this.initStatement(new stm.VarAssignStatement(), this.getNextToken())
            }
          }
        }
      }
    }

    if (!statement) {
      const token = this.getNextToken()
      if (token) {
        statement = this.parseKeyword(token)
        if (!statement) {
          statement = this.parseOpcode(token)
          if (!statement) {
            statement = this.parseMacroInvoke(token)
            if (!statement) {
              token.setError("Unexpected token")
              statement = this.initStatement(new stm.GenericStatement(), token)
            }
          }
        }
      } else {
        statement = this.initStatement(new stm.GenericStatement())
      }
    }

    // handle extra tokens
    // *** don't generate more errors if this already has an error ***
    let token = this.getNextToken()
    let silent = false
    if (token) {

      // TODO: fix this hack to suppress errors on multi-statements
      if (this.syntax == Syntax.ACME) {
        if (token.getString() == ":") {
          silent = true
        }
      }

      const extraTokens: Token[] = []
      do {
        if (!silent) {
          token.setError("Unexpected token")
          extraTokens.push(token)
        }
        token = this.getNextToken()
      } while (token)
      // *** flatten all tokens into a single token? ***
                          // *** name collision with ERR statement?
                          // *** just use generic Expression?
      // *** just push the tokens directly? ***
        // *** BadExpression ***
      this.addExpression(new exp.BadExpression(extraTokens))
    }

    // handle possible comment at end of statement
    this.skipWhitespace()
    this.pushNextComment()

    // *** if not macro, if not dummy, if not disabled ***
      // *** not assignment?
    {
      if (statement.labelExp && statement.labelExp instanceof exp.SymbolExpression) {
        const symValue = statement.labelExp.symbol?.getValue()
        if (!symValue) {
          statement.labelExp?.symbol?.setValue(new exp.PcExpression(), SymbolFrom.Org)
        }
      }
    }

    return statement
  }

  private parseKeyword(token: Token): stm.Statement | undefined {
    let statement: stm.Statement | undefined

    let keywordLC = token.getString().toLowerCase()
    let altwordLC: string | undefined

    if (this.syntax == Syntax.CA65) {
      // CA65 allows labels that start with "." if they are followed by ":"
      if (keywordLC[0] == ".") {
        const nextChar = this.peekVeryNextChar()
        if (nextChar == ":") {
          return
        }
      }
    }

    // DASM allows optional "." or "#" on all directives
    if (!this.syntax || this.syntax == Syntax.DASM) {
      if (keywordLC[0] == "." || keywordLC[0] == "#") {
        altwordLC = keywordLC.substring(1)
      }
    }

    // TODO: need a better way to handle this
    if (keywordLC == "}") {
      // ACME syntax ends conditionals, zones, and other blocks with '}'
      if (!this.syntax || this.syntax == Syntax.ACME) {
        const elseToken = this.peekNextToken()
        if (elseToken) {
          if (elseToken.getString().toLowerCase() == "else") {
            statement = new stm.AcmeElseStatement()
            this.syntaxStats[Syntax.ACME] += 1
            // TODO: may need to look for another opening brace here?
          }
        } else {
          statement = new stm.ClosingBraceStatement()
          this.syntaxStats[Syntax.ACME] += 1
        }
      }
    }

    if (statement) {
      return this.initStatement(statement, token)
    }

    if (this.syntax) {
      return this.buildStatement(token, keywordLC, altwordLC)
    }

    // Parse statement with each of the syntaxes that support
    //  the given keyword.  Track which were successful and
    //  return the best result.

    const startTokenType = token.type
    const startPosition = this.position
    const statements = []
    let successCount = 0
    let firstSuccess = -1
    let failureCount = 0

    statements.push(undefined)
    for (let i = 1; i < SyntaxDefs.length; i += 1) {

      // temporarily force syntax and syntaxDef
      this.syntax = i

      const statement = this.buildStatement(token, keywordLC, altwordLC)
      if (statement) {

        statements.push({ statement, position: this.position })

        if (statement.hasAnyError() || this.peekNextToken() !== undefined) {
          failureCount += 1
        } else {
          successCount += 1
          this.syntaxStats[i] += 1
          if (firstSuccess == -1) {
            firstSuccess = i
          }
        }
      } else {
        statements.push(undefined)
      }

      token.type = startTokenType
      this.position = startPosition
    }
    this.syntax = Syntax.UNKNOWN

    if (successCount == 0 && failureCount > 0) {
      for (let i = 1; i < statements.length; i += 1) {
        if (statements[i] !== undefined) {
          this.syntaxStats[i] += 1
          if (firstSuccess < 0) {
            firstSuccess = i
          }
        }
      }
    }

    if (firstSuccess >= 0) {
      const state = statements[firstSuccess]
      this.position = state?.position ?? startPosition
      return state?.statement
    }
  }

  private buildStatement(token: Token, keywordLC: string, altwordLC?: string): stm.Statement | undefined {

    let keywordDef = SyntaxDefs[this.syntax].keywordMap.get(keywordLC)
    if (!keywordDef && altwordLC) {
      keywordDef = SyntaxDefs[this.syntax].keywordMap.get(altwordLC)
    }
    if (!keywordDef) {
      return
    }
    if (keywordDef.alias) {
      keywordDef = SyntaxDefs[this.syntax].keywordMap.get(keywordDef.alias)
      if (!keywordDef) {
        return
      }
    }

    let statement: stm.Statement
    if (keywordDef.create) {
      statement = keywordDef.create()
    } else {
      // TODO: remove this and make all syntax table entries create the correct type
      statement = new stm.GenericStatement()
    }
    if (keywordDef.params !== undefined) {
      if (!keywordDef.paramsList) {
        const paramsDef = SyntaxDefs[this.syntax].paramDefMap
        keywordDef.paramsList = this.paramsParser.parseString(keywordDef.params, paramsDef)
      }
    }

    token.type = TokenType.Keyword
    return this.initStatement(statement, token, keywordDef)
  }

  private parseOpcode(token: Token): stm.Statement | undefined {
    let opNameLC = token.getString().toLowerCase()
    let opSuffix = ""
    const n = opNameLC.indexOf(".")
    if (n > 0) {  // ignore prefix "."
      opSuffix = opNameLC.substring(n + 1)
      opNameLC = opNameLC.substring(0, n)
      // TODO: check for known suffixes here?
    }
    for (let i = 0; i < OpcodeSets.length; i += 1) {
      const opcodeSet = OpcodeSets[i]
      let opcode = (opcodeSet as {[key: string]: any})[opNameLC]
      if (opcode !== undefined) {
        token.type = TokenType.Opcode
        let forceLong = false
        if (!this.syntax || this.syntax == Syntax.MERLIN) {
          // on Merlin, ":" immediately after opcode forces 16-bit addressing
          const c = this.peekVeryNextChar()
          if (c == ":") {
            this.position += 1
            token.end += 1
            forceLong = true
          }
        }
        // TODO: pass in suffix?
        return this.initStatement(new stm.OpStatement(opcode, opSuffix, i, forceLong), token)
      }
    }
  }

  private parseMacroInvoke(token: Token): stm.Statement | undefined {

    if (this.syntaxDef.macroInvokePrefixes) {
      if (!this.syntaxDef.macroInvokePrefixes.includes(token.getString())) {
        return
      }
      const nextToken = this.getVeryNextToken()
      if (!nextToken || (nextToken.type != TokenType.Symbol && nextToken.type != TokenType.HexNumber)) {
        return
      }
      token.type = TokenType.Macro
      this.addToken(token)
      token = nextToken
    }

    token.type = TokenType.Macro
    const symExp = this.newSymbolExpression([token], SymbolType.TypeName, false)
    return this.initStatement(new stm.MacroInvokeStatement(), symExp)
  }

  private initStatement(statement: stm.Statement, opTokenExp?: Token | exp.Expression, keywordDef?: KeywordDef): stm.Statement {
    if (opTokenExp) {
      if (opTokenExp instanceof Token) {
        opTokenExp = new exp.Expression([opTokenExp])
      }
      this.addExpression(opTokenExp)
    }
    statement.init(this.sourceLine, this.endExpression(), this.labelExp, opTokenExp, keywordDef)
    statement.parse(this)
    statement.postParse(this)
    return statement
  }

  private parseSymbol(isDefinition: boolean, token?: Token): exp.Expression | undefined {

    if (isDefinition) {
      const nextChar = this.peekVeryNextChar()
      if (!nextChar) {
        return
      }

      // these characters may be in the first column
      if (nextChar == "!" || nextChar == "}" || nextChar == "*") {
        if (!this.syntax || this.syntax == Syntax.ACME){
          return
        }
      }

      // if (nextChar == ".") {
      //
      //   // look for possible keywords in the first column and
      //   //  count them but don't parse them
      //   if (!this.syntax) {
      //     const savedPosition = this.position
      //     const t1 = token ?? this.getNextToken()
      //     const keywordLC = t1?.getString().toLowerCase() ?? ""
      //     for (let i = 1; i < SyntaxDefs.length; i += 1) {
      //       const k = SyntaxDefs[i].keywordMap.get(keywordLC)
      //       if (k) {
      //         this.syntaxStats[i] += 1
      //       }
      //     }
      //     this.position = savedPosition
      //   }
      // }

      // detected indented variable assignment
      if (nextChar == " " || nextChar == "\t") {
        const savedPosition1 = this.position
        const t1 = token ?? this.getNextToken()

        const savedPosition2 = this.position
        const t2 = this.getNextToken()

        // ignore "*=$1000" syntax for setting org
        if (!t1 || !t2 || t1.getString() == "*") {
          this.position = savedPosition1
          return
        }

        const t2str = t2.getString().toLowerCase()
        if (t2str == "=") {
          if (this.syntaxDef.allowIndentedAssignment) {
            // TODO: move away from this mechanism
            this.syntaxStats[Syntax.ACME] += 1
            this.syntaxStats[Syntax.CA65] += 1
            this.syntaxStats[Syntax.TASS64] += 1
            token = t1
            this.position = savedPosition2
          } else {
            this.position = savedPosition1
            return
          }
        } else if (t2str == ":=" || t2str == ".set") {
          if (this.syntaxDef.allowIndentedAssignment) {
            // TODO: move away from this mechanism
            this.syntaxStats[Syntax.CA65] += 1
            this.syntaxStats[Syntax.TASS64] += 1
            token = t1
            this.position = savedPosition2
          } else {
            this.position = savedPosition1
            return
          }
        // TODO: hack for handling indented data defs in .structs
        } else if (t2str == ".byte"
            || t2str == ".res"
            || t2str == ".dbyt"
            || t2str == ".word"
            || t2str == ".addr"
            || t2str == ".faraddr"
            || t2str == ".dword"
            || t2str == ".tag") {
          if (this.syntax == Syntax.CA65) {
            token = t1
            this.position = savedPosition2
          } else {
            this.position = savedPosition1
            return
          }
        } else {
          this.position = savedPosition1
          return
        }
      }
    }

    if (!token) {
      token = this.getNextToken()
      if (!token) {
        return
      }
    }

    let str = token.getString()

    // handle Merlin vars before everything else
    if (str[0] == "]") {
      if (!this.syntax || this.syntax == Syntax.MERLIN) {
        this.syntaxStats[Syntax.MERLIN] += 1
        // *** enforce/handle var assignment
          // peekNextToken == "=" ?
        return this.parseVarExpression(token, isDefinition)
      }
    }

    // *** clean this up -- splitting here and then reparsing locals ***
    if (token.type == TokenType.Symbol) {

      let split = false

      // a token that starts with a "." could be a local or a keyword
      //  depending on the syntax
      if (str[0] == ".") {
        // *** fix parseLocal instead? ***
      //   // *** maybe duplicate in parseValueExpression?
      //   // if (isDefinition) {
      //     // *** TODO: add logic to decide when to do this ***
          split = true
      //   // }
      } else if (this.syntaxDef.cheapLocalPrefixes.includes(str[0]) ||
          this.syntaxDef.namedParamPrefixes.includes(str[0])) {
        // NOTE: currently used to handle leading "_" prefix
        split = true
      }

      if (split) {
        // turn the token into a single character and back up
        token.type = TokenType.Operator
        token.end = token.start + 1
        this.position = token.end
        str = str[0]
      }
    }

    if (token.type == TokenType.Operator) {

      if (isDefinition) {
        if (str == "^") {
          if (!this.syntax || this.syntax == Syntax.LISA) {
            this.syntaxStats[Syntax.LISA] += 1
            return this.parseLisaLocal(token, isDefinition)
          }
        } else if (str == ":") {
          if (!this.syntax) {
            const c = this.peekVeryNextChar()
            if (c == " " || c == "\t") {
              // Flag this local label definition as CA65 only if
              //  it is not followed by more text, in order to disambiguate
              //  from Merlin local labels.
              this.syntaxStats[Syntax.CA65] += 1
            }
          }
          if (this.syntax == Syntax.CA65) {
            return this.parseCA65Local(token, isDefinition)
          }
        } else if (str == ".") {
          // CA65 allows labels that start with "." if they are followed by ":"
          if (this.syntax == Syntax.CA65) {
            const c = this.peekVeryNextChar()
            if (c == ":") {
              token.type = TokenType.Label
              const result = this.newSymbolExpression([token], SymbolType.Simple, isDefinition)
              token = this.getVeryNextToken()
              if (token) {
                this.addToken(token)
              }
              return result
            }
            this.ungetToken(token)
          }
        }
      }

      if (this.syntaxDef.anonLocalChars && this.syntaxDef.anonLocalChars.includes(str[0])) {
        if (str[0] == str[str.length - 1]) {
          // TODO: move away from this mechanism
          this.syntaxStats[Syntax.ACME] += 1
          this.syntaxStats[Syntax.TASS64] += 1
          if (str.length > 9) {
            token.setError("Anonymous local is too long")
            return new exp.BadExpression([token])
          }
          token.type = TokenType.Label
          return this.newSymbolExpression([token], SymbolType.AnonLocal, isDefinition)
        }
      }

      // *** clean these up -- just redoing what was undone by split ***
      if (this.syntaxDef.cheapLocalPrefixes.includes(str)) {
        // TODO: if !this.syntax, count by syntax match?
        return this.parseLocal(token, SymbolType.CheapLocal, isDefinition)
      }
      if (this.syntaxDef.zoneLocalPrefixes.includes(str)) {
        // TODO: if !this.syntax, count by syntax match?
        return this.parseLocal(token, SymbolType.ZoneLocal, isDefinition)
      }
      if (this.syntaxDef.namedParamPrefixes.includes(str)) {
        return this.parseLocal(token, SymbolType.NamedParam, isDefinition)
      }
    }

    let localType = SymbolType.Simple
    this.startExpression(token)

    if (isDefinition) {

      if (token.type != TokenType.Symbol &&
          token.type != TokenType.HexNumber) {
        token.setError("Unexpected token, expecting symbol name")
        return new exp.BadExpression(this.endExpression())
      }
      token.type = TokenType.Symbol
      this.pushTrailingColon()

    } else {

      if (str == this.syntaxDef.scopeSeparator) {
        if (this.syntax && this.syntax != Syntax.CA65) {
          token.setError("Unexpected token")
          return new exp.BadExpression(this.endExpression())
        }

        localType = SymbolType.Scoped
        // TODO: what type should scoping colons be?
        token.type = TokenType.Keyword

        token = this.getVeryNextToken()
        if (!token) {
          this.addMissingToken("Missing scope name")
          return new exp.BadExpression(this.endExpression())
        }

        this.addToken(token)
      }

      while (true) {
        if (token.type != TokenType.Symbol && token.type != TokenType.HexNumber) {

          // TODO: fix this hack to suppress errors on multi-statements
          if (this.syntax == Syntax.ACME) {
            if (token.getString() == ":") {
              this.ungetToken(token)
              return
            }
          }

          token.setError("Unexpected token, expecting symbol name")
          return new exp.BadExpression(this.endExpression())
        }

        token.type = TokenType.Symbol

        const savedPosition = this.getPosition()
        token = this.getVeryNextToken()
        if (!token) {
          break
        }
        str = token.getString()
        if (!this.syntaxDef.scopeSeparator || !str.startsWith(this.syntaxDef.scopeSeparator)) {
          this.setPosition(savedPosition)
          break
        }

        if (str.length > this.syntaxDef.scopeSeparator.length) {
          // if the scope separator matches some other prefix, like ".",
          //  then the token needs to be split apart

          const tokens = token.split(this.syntaxDef.scopeSeparator.length)
          tokens[0].type = TokenType.Keyword
          this.addToken(tokens[0])
          tokens[1].type = TokenType.Symbol
          this.addToken(tokens[1])
          localType = SymbolType.Scoped

        } else {
          // if the scope separator is unique, like "::", then
          //   process two token separately

          this.addToken(token)

          // TODO: what type should scoping colons be?
          token.type = TokenType.Keyword
          localType = SymbolType.Scoped

          token = this.getVeryNextToken()
          if (!token) {
            this.addMissingToken("expected symbol name")
            return new exp.BadExpression(this.endExpression())
          }

          this.addToken(token)
        }
      }
    }

    return this.newSymbolExpression(this.endExpression(), localType, isDefinition)
  }

  public newSymbolExpression(children: Node[],
      symbolType: SymbolType, isDefinition: boolean): exp.SymbolExpression {
    return new exp.SymbolExpression(children, symbolType, isDefinition, this.sourceFile, this.lineNumber)
  }

  public insertMissingLabel() {
    const missingToken = new Token(this.sourceLine, 0, 0, TokenType.Missing)
    missingToken.setError("Label required")
    this.nodeSet.unshift(missingToken)
  }

  private pushTrailingColon() {
    // NOTE: ACME allows space between the label and the trailing colon
    const token = this.peekNextToken()
    if (token && token.getString() == ":") {
      this.commitAddToken(token)
      if (!this.syntaxDef.allowLabelTrailingColon) {
        token.setError("Not allowed for this syntax")
      }
    }
  }

  parseLocal(token: Token, symbolType: SymbolType, isDefinition: boolean): exp.Expression {
    this.startExpression(token)
    token.type = TokenType.Label

    let nextToken = this.addVeryNextToken()
    if (nextToken) {
      if (nextToken.type != TokenType.Symbol &&
          nextToken.type != TokenType.HexNumber &&
          nextToken.type != TokenType.DecNumber) {
        nextToken.setError("Invalid label name")
      } else {
        nextToken.type = TokenType.Label
      }
    } else {
      nextToken = this.addMissingToken("Missing local name")
    }

    // look for trailing ':'
    if (isDefinition) {
      this.pushTrailingColon()
    }

    return this.newSymbolExpression(this.endExpression(), symbolType, isDefinition)
  }

  public parseLisaLocal(token: Token, isDefinition: boolean): exp.Expression {
    this.startExpression(token)
    token.type = TokenType.Label

    let nextToken = this.addVeryNextToken()
    if (nextToken) {
      if (nextToken.type == TokenType.DecNumber) {
        if (nextToken.getString().length != 1) {
          nextToken.setError("Only single digit allowed")
        } else {
          nextToken.type = TokenType.Label
        }
      } else {
        nextToken.setError("Must be single decimal digit")
      }
    } else {
      nextToken = this.addMissingToken("Missing decimal digit")
    }

    return this.newSymbolExpression(this.endExpression(), SymbolType.LisaLocal, isDefinition)
  }

  public parseCA65Local(token: Token, isDefinition: boolean): exp.Expression {
    this.startExpression(token)
    token.type = TokenType.Label

    if (!isDefinition) {
      let nextToken = this.addVeryNextToken()
      if (nextToken) {
        const str = nextToken.getString()
        if (nextToken.type == TokenType.Operator &&
          ((str[0] == "-" || str[0] == "+") && (str[0] == str[str.length - 1]))) {
          nextToken.type = TokenType.Label
        } else {
          nextToken.setError("Must be + or -")
        }
      } else {
        nextToken = this.addMissingToken("Missing + or -")
      }
    }

    return this.newSymbolExpression(this.endExpression(), SymbolType.CA65Local, isDefinition)
  }

  private mustParseExpression(token?: Token): exp.Expression {
    if (!token) {
      token = this.mustGetNextToken("expected expression")
    }
    if (token.type == TokenType.Missing) {
      return new exp.BadExpression([token])
    }

    // let start = this.position
    let expression = this.parseExpression(token)
    if (!expression) {
      // *** token = new Token(this.sourceLine, start, start, TokenType.Missing)
      token.setError("Expected expression")
      expression = new exp.BadExpression([token])
    }
    return expression
  }

  // parse <function>([<param> [, ...]])

  // TODO: much more work is needed here
  //  Need to check if the command is a known built-in function
  //  or declared by a previously .define.
  public parseFunctionExpression(token: Token): exp.Expression | undefined {
    this.startExpression(token)

    // TODO: is this the right type? -- keyword or macro instead?
    token.type = TokenType.TypeName

    let nextToken = this.peekNextToken()
    if (nextToken && nextToken.getString() == "(") {
      // define invoke/built-in call with optional parameters
      this.commitAddToken(nextToken)
      while (true) {
        nextToken = this.mustGetNextToken("expecting expression or ')")
        if (nextToken.getString() == ")") {
          this.addToken(nextToken)
          break
        }
        this.mustAddNextExpression(nextToken)
        const res = this.mustAddToken(["", ",", ")"])
        if (res.index < 0) {
          // TODO: return a bad expression instead?
          return
        }
        if (res.index == 2) {
          break
        }
      }
    } else {
      // built-in call without parens or parameters
      // TODO: return undefined if no match
    }
    return new exp.Expression(this.endExpression())
  }

  // *** what happens to token if not used?
    // *** force this.position = token.end ???
  public parseValueExpression(token: Token): exp.Expression | undefined {

    let str = token.getString()

    if (token.type == TokenType.Symbol) {
      // TODO: this needs to be generalized
      if (str[0] == ".") {
        // For CA65, symbol tokens starting with "." are almost never symbols.
        //  They're either .define invocations or built-in functions,
        //  unless a label was defined in the form ".label:"
        if (this.syntax == Syntax.CA65) {
          // TODO: skip this when the token is not a function name
          return this.parseFunctionExpression(token)
        }

        return this.parseSymbol(false, token)
      }
    } else if (token.type == TokenType.Operator) {
      if (str == "$" || str == "%") {
        return this.parseNumberExpression(token)
      }
      if (str == "*") {
        token.type = TokenType.Keyword
        return new exp.PcExpression(token)
      }
      if (str == ".") {
        if (this.syntax && this.syntax == Syntax.DASM) {
          token.type = TokenType.Keyword
          return new exp.PcExpression(token)
        }
      }
      // if (str == "[") {
      //   if (this.syntax && this.syntax == Syntax.TASS64) {
      //     return this.parseArrayExpression(token)
      //   }
      // }
      if (str == '"' || str == "'") {
        // *** how to choose between string literals and strings? ***
        // *** pick these values dynamically ***
        const allowUnterminated = false
        return this.parseStringExpression(token, this.syntaxDef.allowStringEscapes, allowUnterminated)
      }
      if (str == "!") {
        // *** LISA supports '!' prefix for decimal numbers, including "!-9"
        // *** could be keyword
        // *** otherwise, return nothing
        return
      }
      if (str == ":" || str == this.syntaxDef.scopeSeparator) {
        // *** possible cheap locals (MERLIN)
        // *** possible macro local (SBASM)
        // *** possible macro divider (ACME)
        return this.parseSymbol(false, token)
      }
      if (str == "@") {
        // *** possible cheap locals
        return this.parseSymbol(false, token)
      }
      if (str == "#") {
        if (this.syntax == Syntax.DASM) {
          this.addToken(token)
          return this.mustAddNextExpression()
        }
      }

      // ACME/64TASS anonymous locals
      // TODO: It's currently not possible to arrive here with str == "-" because
      //  that will have already been treated as a unary operator.
      if (this.syntaxDef.anonLocalChars && this.syntaxDef.anonLocalChars.includes(str[0])) {
        if (str[0] == str[str.length - 1]) {
          return this.parseSymbol(false, token)
        }
      }

      // NOTE: #>, #< (LISA) and ++,-- (ACME) are handled in OpStatement parsing

      // if (str[0] == ".") {
      //   // *** look for keywords before looking for symbols ***
      //   // if not keyword, split off '.'
      //   // *** parse symbol
      //   // *** if not symbol, ???
      //   return this.parseSymbol(false, token)
      // }
      if (str == "]") {
        if (!this.syntax || this.syntax == Syntax.MERLIN) {
          return this.parseVarExpression(token, false)
        }
        return
      }
      if (str == ",") {
        // ***
      }
      // *** what about unknown?
      return
    }
    if (token.type == TokenType.DecNumber) {
      return this.parseNumberExpression(token)
    }

    return this.parseSymbol(false, token)
  }

  parseExpression(inToken?: Token): exp.Expression | undefined {
    const expBuilder = new ExpressionBuilder(this)
    return expBuilder.parse(inToken)
  }

  parseArrayExpression(token: Token): exp.ArrayExpression {
    this.startExpression(token)
    while (true) {
      const expression = this.addNextExpression()
      if (!expression) {
        break
      }
      const res = this.mustAddToken(["]", ","])
      if (res.index <= 0) {
        break
      }
    }
    return new exp.ArrayExpression(this.endExpression())
  }

  // *** LISA uses '!' prefix for decimal numbers ***
  parseNumberExpression(token: Token): exp.NumberExpression {
    let value = NaN
    let forceLong = false

    this.startExpression(token)
    let str = token.getString()
    if (str == "$") {
      // *** should "$" be HexNumber or left as Operator?
      token.type = TokenType.HexNumber
      token = this.mustAddNextToken("expecting hex digits")
      str = token.getString()
      if (token.type == TokenType.HexNumber || token.type == TokenType.DecNumber) {
        value = parseInt(str, 16)
        if (value != value) {
          token.setError("Invalid hex format")
        }
        forceLong = str.length > 2
      } else if (str != "") {
        token.setError("Unexpected token, expecting hex digits")
      }
    } else if (str == "%") {
      // *** should "%" be DecNumber or left as Operator?
      // *** support ACME's %..####.. format too
      token.type = TokenType.DecNumber
      token = this.mustAddNextToken("expecting binary digits")
      str = token.getString()
      if (token.type == TokenType.DecNumber) {
        value = parseInt(str, 2)
        if (value != value) {
          token.setError("Invalid binary format")
        }
        forceLong = str.length > 8
      } else if (str != "") {
        token.setError("Unexpected token, expecting binary digits")
      }
    } else /*if (token.type == TokenType.DecNumber)*/ {
      value = parseInt(str, 10)
      forceLong = value > 256 || value < -127
    }
    return new exp.NumberExpression(this.endExpression(), value, forceLong)
  }

  // Collect all tokens of a string, including opening quote,
  //  actual text, escape characters and terminating quote.

  parseStringExpression(quoteToken: Token, allowEscapes: boolean, allowUnterminated = false): exp.StringExpression {

    quoteToken.type = TokenType.Quote
    this.startExpression(quoteToken)
    let terminator = quoteToken.getString()

    // TODO: just to support NajaText USR parsing
    if (!this.syntax || this.syntax == Syntax.MERLIN) {
      if (terminator == "(") {
        terminator = ")"
        quoteToken.type = TokenType.Operator
      }
    }

    let token = new Token(this.sourceLine, this.position, this.position, TokenType.String)
    while (token.end < this.sourceLine.length) {
      const nextChar = this.sourceLine[token.end]
      if (nextChar == terminator) {
        // close string if any, and add terminator token
        if (!token.isEmpty()) {
          this.addToken(token)
          this.position = token.end
        }
        token = new Token(this.sourceLine, this.position, this.position + 1, quoteToken.type)
        break
      }
      if (nextChar == "\\" && allowEscapes) {
        // close string if any, and add character escape token
        if (!token.isEmpty()) {
          this.addToken(token)
          this.position = token.end
        }
        token = new Token(this.sourceLine, this.position, this.position + 1, TokenType.Escape)
        if (token.end == this.sourceLine.length) {
          token.setError("Unterminated character escape")
          break
        }
        token.end += 1
        this.addToken(token)
        this.position = token.end
        token = new Token(this.sourceLine, this.position, this.position, TokenType.String)
        continue
      }
      token.end += 1
    }

    if (token.isEmpty()) {
      token.type = TokenType.Missing
      if (allowUnterminated) {
        token.setWarning("Unterminated string")
      } else {
        token.setError("Unterminated string")
      }
    }
    this.addToken(token)
    this.position = token.end

    // TODO: just to support NajaText USR parsing
    if (!this.syntax || this.syntax == Syntax.MERLIN) {
      if (terminator == ")") {
        const nextChar = this.peekVeryNextChar()
        if (nextChar) {
          if ("=+-".indexOf(nextChar) != -1) {
            this.addNextToken()
          }
        }
      }
    }

    return new exp.StringExpression(this.endExpression(), this.syntax)
  }

  // TODO: pass in a list of required quote characters
  getNextFileNameExpression(): exp.FileNameExpression | undefined {

    this.skipWhitespace()
    const startPosition = this.position

    // TODO: decide which quote chars are supported, by syntax
    const beginChar = this.sourceLine[this.position++]
    let endChar = ""
    if (beginChar == '"' || beginChar == "'") {
      endChar = beginChar
    } else if (beginChar == "<") {
      endChar = ">"
    } else {
      this.position -= 1
    }

    if (this.position < this.sourceLine.length) {

      if (endChar != "") {
        // TODO: enforce/allow quotes for only some syntaxes?
        while (this.position < this.sourceLine.length) {
          const nextChar = this.sourceLine[this.position++]
          if (nextChar == endChar) {
            break
          }
        }
      } else {
        while (this.position < this.sourceLine.length) {
          const nextCode = this.sourceLine.charCodeAt(this.position)
          if ((nextCode >= 0x30 && nextCode <= 0x39) ||			// 0-9
              (nextCode >= 0x41 && nextCode <= 0x5A) ||		  // A-Z
              (nextCode >= 0x61 && nextCode <= 0x7A)) {		  // a-z
            this.position += 1
            continue
          }
          const nextChar = this.sourceLine[this.position]
          if (nextChar == "_" || nextChar == "." || nextChar == "/") {
            this.position += 1
            continue
          }
          break
        }
      }
    }

    if (this.position > startPosition) {
      const token = new Token(this.sourceLine, startPosition, this.position, TokenType.FileName)
      return new exp.FileNameExpression(token)
    }
  }

  // caller has already checked for Merlin and that token starts with "]"
  parseVarExpression(varToken: Token, isDefinition: boolean): exp.SymbolExpression {
    varToken.type = TokenType.Variable

    // TODO: for now, treat all variables as definitions
    //  until reference tracking and macro usage is resolved
    isDefinition = true

    return new exp.SymbolExpression([varToken], SymbolType.Variable, isDefinition)
  }

  private pushNextComment() {
    if (this.position < this.sourceLine.length) {
      // special case Merlin '*' line comments
      // NOTE: peekNextChar won't work here because it stops at comment
      if (this.position == 0 && this.sourceLine[0] == "*") {
        if (!this.syntax) {
          // look for "*=$xxxx" at start of line
          const mark = this.position
          const starToken = this.getNextToken()
          const equalToken = this.getNextToken()
          this.position = mark
          if (equalToken && equalToken.getString() == "=") {
            if (equalToken.start <= 3) {
              // if found, don't treat it as a merlin line comment
              return
            }
          }
        } else if (this.syntax != Syntax.MERLIN) {
          return
        }
      } else if (this.sourceLine[this.position] != ";") {
        return
      }

      const token = new Token(this.sourceLine, this.position, this.sourceLine.length, TokenType.Comment)

      // *** for debugging, scan comment for syntax setting ***
        // *** remove need to scan entire comment ***
      if (this.position == 0) {
        const str = token.getString().toUpperCase()
        const index = str.indexOf("SYNTAX:")
        if (index != -1) {
          const name = str.substring(index + 7)
          this.syntax = SyntaxMap.get(name) ?? this.syntax
        }
      }

      this.position = this.sourceLine.length
      this.addToken(token)
    }
  }
}

//------------------------------------------------------------------------------

// Algorithms for Infix and Postfix expression parsing
//  http://www.neocomputer.org/projects/lang/infix.html

class OpEntry {
  public token: Token
  public op: Op
  public precedence: number
  public rightAssoc: boolean
  public groupEnd: string
  public isUnary: boolean

  constructor(token: Token, opDef: OpDef, unary: boolean) {
    this.token = token
    this.op = opDef.op
    this.precedence = opDef.pre
    this.rightAssoc = opDef.ra ?? false
    this.groupEnd = opDef.end ?? ""
    this.isUnary = unary
  }
}

class ExpressionBuilder {

  private parser: Parser

  private opStack: OpEntry[] = []          // Infix to Postfix conversion
  private expStack: exp.Expression[] = []  // Postfix evaluation
  private lastSeen?: (OpEntry | exp.Expression)
  private parenStack: OpEntry[] = []
  private inputSet: Node[] = []

  // *** pass in hint about type of expression
  // *** mustParseExpression ***

  constructor(parser: Parser) {
    this.parser = parser
  }

  // *** what if token not used?

  // *** maybe pass in syntax to be used?

  // NOTE: This will return some kind of expression unless
  //  there are no more tokens or if an unknown token type
  //  is immediately found.

  parse(inToken?: Token): exp.Expression | undefined {

    this.opStack = []
    this.expStack = []
    this.parenStack = []
    this.inputSet = []
    this.lastSeen = undefined

    // consume operators and expressions in Infix order and process them on Postfix order
    while (true) {

      const token = inToken ? inToken : this.parser.getNextToken()
      inToken = undefined
      if (!token) {
        break
      }

      let isUnary = true
      if (this.lastSeen) {
        if (this.lastSeen instanceof exp.Expression) {
          isUnary = false
        }
      }

      // *** deal with merlin "." operator versus symbols here ***
      // *** search for scoped label first? ***
      // *** what about "," or other expression enders?

      // check token for closing paren, etc.
      const openOp = this.parenStack.pop()
      if (openOp) {
        if (token.getString() == openOp.groupEnd) {
          this.inputSet.push(token)
          if (!this.processGroup(openOp, token)) {
            return this.badExpression()
          }
          continue
        } else {
          this.parenStack.push(openOp)
        }
      }

      const nextOp = this.parseOperator(token, isUnary)
      if (nextOp) {
        this.lastSeen = nextOp
        this.inputSet.push(nextOp.token)

        // check token for opening paren, etc.
        if (nextOp.op == Op.Group) {
          this.parenStack.push(nextOp)
          this.opStack.push(nextOp)
          continue
        }

        if (nextOp.isUnary) {
          // NOTE: All unary operators are assumed/forced to be right associative.
          //  Only posfix operators would be left-associative, but none are supported.
          //
          // *** does this handle unary ops of different precedence? ***
          this.opStack.push(nextOp)
        } else {
          while (true) {
            const opEntry = this.opStack.pop()
            if (!opEntry) {
              break
            }

            if (opEntry.precedence >= nextOp.precedence ||
              (nextOp.rightAssoc && opEntry.precedence == nextOp.precedence)) {
                if (!this.processOperator(opEntry)) {
                  return this.badExpression()
                }
            } else {
              this.opStack.push(opEntry)
              break
            }
          }

          this.opStack.push(nextOp)
        }
        continue
      }

      // values/operands are always pushed to output stack
      const nextExp = this.parser.parseValueExpression(token)
      if (!nextExp) {
        // *** check for ',' and treat all others as error?
        // *** for now, stop and back up at any unknown token ***
        // *** maybe add parser.ungetToken(token)? ***
        this.parser.setPosition(token.start)
        break
      }

      this.lastSeen = nextExp
      this.inputSet.push(nextExp)
      this.expStack.push(nextExp)
    }

    // process remaining ops on stack
    while (true) {
      const opEntry = this.opStack.pop()
      if (!opEntry) {
        break
      }
      if (!this.processOperator(opEntry)) {
        return this.badExpression()
      }
    }

    // nothing should be left on stacks
    if (this.opStack.length || this.parenStack.length) {
      return this.badExpression()
    }

    // there should now be zero or one expression left on the stack
    if (this.expStack.length > 1) {
      return this.badExpression()
    }

    return this.expStack.pop()
  }

  private badExpression(): exp.Expression {
    const token = this.parser.createMissingToken()
    token.setError("Parsing error")
    this.inputSet.push(token)
    const expression = new exp.BadExpression(this.inputSet)
    return expression
  }

  private parseOperator(token: Token, isUnary: boolean): OpEntry | undefined {
    const syntax: SyntaxDef = SyntaxDefs[this.parser.syntax]
    const opName = token.getString().toUpperCase()
    let opDef: OpDef | undefined
    if (isUnary) {
      opDef = syntax.unaryOpMap?.get(opName)
    } else {
      opDef = syntax.binaryOpMap?.get(opName)
    }
    if (opDef) {
      // turn symbols like "mod" and "div" into operators
      if (token.type == TokenType.Symbol) {
        token.type = TokenType.Operator
      }
      return new OpEntry(token, opDef, isUnary)
    }
  }

  private processOperator(opEntry: OpEntry): boolean {
    if (opEntry.isUnary) {
      let arg = this.expStack.pop()
      if (!arg) {
        return false
      }
      this.expStack.push(new exp.UnaryExpression(opEntry.token, opEntry.op, arg))
    } else {
      if (this.expStack.length < 2) {
        return false
      }
      let arg2 = this.expStack.pop()
      let arg1 = this.expStack.pop()
      if (arg1 && arg2) {
        this.expStack.push(new exp.BinaryExpression(arg1, opEntry.token, opEntry.op, arg2))
      }
    }
    return true
  }

  // process operators until opening group op is found
  private processGroup(openOp: OpEntry, closeToken: Token): boolean {
    while (true) {
      const opEntry = this.opStack.pop()
      if (!opEntry) {
        return false
      }
      if (opEntry == openOp) {
        break
      }
      if (!this.processOperator(opEntry)) {
        return false
      }
    }

    // *** is empty parens an error? ***

    let arg = this.expStack.pop()
    if (!arg) {
      return false
    }
    const groupExp = new exp.ParenExpression([openOp.token, arg, closeToken])
    this.expStack.push(groupExp)
    this.lastSeen = groupExp
    return true
  }
}

//------------------------------------------------------------------------------
