
// TODO: rename this parser.ts (rpw65 will be higher level)

import * as asm from "./assembler"
import { Opcodes6502 } from './opcodes'
import { Keywords } from './keywords'
import * as exp from "./expressions"
import * as stm from "./statements"
import * as sym from "./symbols"
import { LinkedEditingRangeFeature } from 'vscode-languageserver/lib/common/linkedEditingRange'

// *** "Missing token" to "Missing argument" ? ***

// not supporting /* */ comments (dasm, ca65)
// . and @ locals have different scoping rules in acme
// ca65 treats a label and symbol differently, based on trailing colon

//*** turn DUMMY 0 into constants ***

//*** apply some scanning only on save ***

//*** how will this be reused in dbug when parsing text ***
//*** how will this be reused for smart completion

//------------------------------------------------------------------------------

export enum TokenType {
  Null,   // *** unused?
  Comment,

  Label,
  LocalLabel,
  Variable,

  Opcode,
  Keyword,
  Macro,

  Symbol,
  HexNumber,
  DecNumber,
  Operator,

  FileName,   // TODO: or just use quoted string?
  String,

  Missing
}

export enum TokenErrorType {
  None,
  Error,
  Warning,
  Info
}

export type TokenError = {
  type: TokenErrorType,
  message: string
}

export class Token {
  public start: number
  public end: number
  public type: TokenType
  public errorType: TokenErrorType
  public errorMessage?: string
  //*** consider an error sub-type ***
  public symbol?: sym.Symbol

  // *** consider putting string in token ***
  constructor(start: number, end: number, type: TokenType) {
    this.start = start
    this.end = end
    this.type = type
    this.errorType = TokenErrorType.None
  }

  get length(): number {
    return this.end - this.start
  }

  getString(sourceLine: string): string {
    return sourceLine.substring(this.start, this.end)
  }

  // isNull(): boolean {
  //   return this.type == TokenType.Null
  // }

  isEmpty(): boolean {
    return this.start == this.end
  }

  setError(message: string) {
    if (this.errorType != TokenErrorType.Error) {
      this.errorType = TokenErrorType.Error
      this.errorMessage = message
    }
  }

  setWarning(message: string) {
    if (this.errorType != TokenErrorType.Error &&
        this.errorType != TokenErrorType.Warning) {
      this.errorType = TokenErrorType.Warning
      this.errorMessage = message
    }
  }

  setInfo(message: string) {
    if (this.errorType == TokenErrorType.None) {
      this.errorType = TokenErrorType.Info
      this.errorMessage = message
    }
  }

  static Null: Token = new Token(0, 0, TokenType.Null)
}

//------------------------------------------------------------------------------

type ConditionalState = {
  enableCount: number,
  satisfied: boolean,
  statement?: stm.ConditionalStatement
}

export class Conditional {
  private enableCount = 1
  private satisfied = true
  public statement?: stm.ConditionalStatement
  private stack: ConditionalState[] = []

  public push(): boolean {
    // set an arbitrary limit on stack size to catch infinite recursion
    if (this.stack.length > 255) {
      return false
    }
    this.stack.push({ enableCount: this.enableCount, satisfied: this.satisfied, statement: this.statement})
    this.enableCount -= 1
    this.satisfied = false
    this.statement = undefined
    return true
  }

  public pull(): boolean {
    if (this.stack.length == 0) {
      return false
    }
    const state = this.stack.pop()
    if (state) {
      this.enableCount = state.enableCount
      this.satisfied = state.satisfied
      this.statement = state.statement
    }
    return true
  }

  public setSatisfied(satisfied: boolean) {
    this.satisfied = satisfied
  }

  public isSatisfied(): boolean {
    return this.satisfied
  }

  public enable() {
    this.enableCount += 1
  }

  public disable() {
    this.enableCount -= 1
  }

  public isEnabled(): boolean {
    return this.enableCount > 0
  }
}

//------------------------------------------------------------------------------

// *** Parser extends a separate Tokenizer class? ***
export class Parser {

  public assembler: asm.Assembler
  public conditional = new Conditional()
  private symbols: sym.Symbols

  private sourceFile: asm.SourceFile | undefined
  private lineNumber: number = -1
  private sourceLine: string = ""
  private sourceLineUC: string = ""
  private position: number = 0
  private tokens: Token[] = []
  private macroArgMode: boolean = false

  public syntax: string = "MERLIN"			// TODO: make configurable

  constructor(assembler: asm.Assembler) {
    this.assembler = assembler
    this.symbols = assembler.module.symbols
  }

  private setSourceLine(lineRecord: asm.LineRecord, sourceLine: string) {
    this.sourceFile = lineRecord.sourceFile
    this.lineNumber = lineRecord.lineNumber
    this.sourceLine = sourceLine
    this.sourceLineUC = sourceLine.toUpperCase()
    this.position = 0
    this.tokens = []
    this.macroArgMode = false
  }

  // *** consider putting string in token ***
  getTokenString(token: Token): string {
    return token.getString(this.sourceLine)
  }

  getTokenStringUC(token: Token): string {
    return token.getString(this.sourceLineUC)
  }

  getPosition(): number {
    return this.position
  }

  setPosition(position: number) {
    this.position = position
  }

  setMacroArgMode(enable: boolean) {
    if (enable) {
      // skip initialize whitespace before args
      this.skipWhiteSpace()
    }
    this.macroArgMode = enable
  }

  parseStatement(lineRecord: asm.LineRecord, sourceLine: string) {

    let statement: stm.Statement | undefined

    this.setSourceLine(lineRecord, sourceLine)

    if (!this.conditional.isEnabled()) {
      let token = this.pushNextToken()
      const str = this.getTokenStringUC(token)
      let keyword = (Keywords as {[key: string]: any})[str]
      if (keyword !== undefined) {
        //*** check for assembler-specific keywords ***
        //*** add error on wrong syntax ***
        if (str == "IF" || str == "DO" || str == "ELIF" ||
            str == "ELSE" || str == "ENDIF" || str == "FIN") {
          // *** check if hasLabel
          token.type = TokenType.Keyword
          statement = new stm.ConditionalStatement()

          //*** share with below ***
          statement.init(str, sourceLine, this.tokens)
          statement.parse(this)
          lineRecord.statement = statement
          if (!this.conditional.isEnabled()) {
            statement.tokens = []
          } else {
            // NOTE: this also flushes out any endline comment
            token = this.pushNextToken()
            if (!token.isEmpty()) {
              token.setError("Unexpected token")
            }
          }
        }
      }
      if (!statement) {
        statement = new stm.Statement()
        lineRecord.statement = statement
      }
      return
    }

    let symbol = this.parseLabel()
    let statementType = "NONE"

    let token = this.parseOpcode()
    if (!token.isEmpty()) {

      // make sure whitespace, not other tokens come immediately after op/keyword
      // let c = this.peekVeryNextChar()
      // if (c != "" && c != " " && c != "\t") {
      //   token.setError("Unexpected token")
      //   //*** extend if this is a ";" token?
      // } else
      {
        statementType = token.getString(this.sourceLineUC)
        let opcode = (Opcodes6502 as {[key: string]: any})[statementType]
        if (opcode !== undefined) {
          token.type = TokenType.Opcode
          this.tokens.push(token)
          statement = new stm.OpStatement(opcode)
        } else {
          let keyword = (Keywords as {[key: string]: any})[statementType]
          if (keyword !== undefined) {
            //*** check for assembler-specific keywords ***
              //*** add error on wrong syntax ***

            token.type = TokenType.Keyword
            this.tokens.push(token)

            if (keyword.create) {
              statement = keyword.create()
            }

            //*** figure out which type of keyword statement ***
          } else {
            //*** single character symbol

            // TODO: look through known macros first
            token.type = TokenType.Macro
            this.tokens.push(token)

            // *** what if no args but has comment? ***

            statement = new stm.MacroStatement()


            // *** macro statement
          }
        }
      }
    }

    if (!statement) {
      statement = new stm.Statement()
    }
  
    statement.init(statementType, sourceLine, this.tokens, symbol)
    statement.parse(this)

    // NOTE: this also flushes out any endline comment
    token = this.pushNextToken()
    if (!token.isEmpty()) {
      token.setError("Unexpected token")
    }

    lineRecord.statement = statement
  }

  private parseOpcode(): Token {
    let opToken = this.pushNextToken()
    opToken.type = TokenType.Opcode
    // TODO: only non-Merlin allows for "." in opcode
    while (this.peekVeryNextChar() == ".") {
      let dotToken = this.veryNextToken()
      opToken.end = dotToken.end
      let nextToken = this.veryNextToken()
      if (nextToken.type == TokenType.Symbol
        || nextToken.type == TokenType.DecNumber
        || nextToken.type == TokenType.HexNumber) {
        opToken.end = nextToken.end
      } else {
        // *** error on this token
      }
    }
    return opToken
  }

  private parseLabel(): sym.Symbol | undefined {

    if (this.position == this.sourceLine.length) {
      return
    }

    const nextChar = this.peekVeryNextChar()
    if (nextChar == " " || nextChar == "\t" || nextChar == "") {
      // this.skipWhiteSpace()
      return
    }

    let token = this.pushNextToken()
    if (token.isEmpty()) {
      return
    }

    const start = token.start
    const value = token.getString(this.sourceLine)

    // TODO: check for specific assembler syntax
    if (value == ":" || value == "." || value == "@") {
      let token2 = this.veryNextToken()
      //*** bad if null, what then? ***
      if (token2.isEmpty()) {
        return
      }
      token.end = token2.end
      token.type = TokenType.LocalLabel
    } else if (value == "]") {		// TODO: merlin-only
      let token2 = this.veryNextToken()
      //*** bad if null, what then? ***
      if (token2.isEmpty()) {
        return
      }
      token.end = token2.end
      token.type = TokenType.Variable
    }
    // TODO: deal with "-" and "+" labels for some assemblers
    else {
      //*** bad if null, what then? ***
      token.type = TokenType.Label

      //*** make sure there's white space or end of line afterwards
      //*** look for trailing ":" for some assemblers
      if (this.peekVeryNextChar() == ":") {
        token.end += 1
        this.position += 1
      }
    }

    let c = this.peekVeryNextChar()
    if (c != " " && c != "\t" && c != ";" && c != "") {
      //*** error -- nothing right after a label
    }

    //*** what about unexpected characters in symbol?
      //*** what if symbol was aaa.bbb, for example?
      //*** label doesn't end until whitespace or end of line

    if (token.type == TokenType.Label) {
      if (this.sourceFile) {
        const label = this.getTokenString(token)
        const symbol = new sym.Symbol(label, this.sourceFile, this.lineNumber, new exp.PcExpression())
        if (!this.symbols.add(symbol)) {
          token.setError("Duplicate symbol")
          // *** somehow link this symbol to the previous definition?
        } else {
          token.symbol = symbol
        }
        // *** add label to global scope symbols
          // *** start new local scope (if Merlin)
        // *** stop returning symbol? ***
        return symbol
      }
    } else if (token.type == TokenType.LocalLabel) {
      // *** add local label to local scope symbols
      // return symbol
    }
  }

  peekVeryNextChar(): string {
    if (this.position < this.sourceLine.length) {
      return this.sourceLine[this.position]
    }
    return ""
  }

  private stripComment(): Token | undefined {
    let start = this.position
    this.skipWhiteSpace()
    let nextChar = this.peekVeryNextChar()
    if ((nextChar == "*" && this.position == 0)
      || (nextChar == ";" && (this.position != start || start == 0))) {
      let comment = new Token(this.position, this.sourceLine.length, TokenType.Comment)
      this.position = this.sourceLine.length
      return comment
    }
  }

  // If no next token is available, create and push
  //  an empty token with error set.
  mustPushNextToken(expectMsg: string): Token {
    let start = this.position
    if (!this.macroArgMode) {
      let comment = this.stripComment()
      if (comment) {
        let token = new Token(start, start, TokenType.Missing)
        token.setError("Missing token, " + expectMsg)
        this.tokens.push(token)
        this.tokens.push(comment)
        return token
      }
    }
    let token = this.veryNextToken()
    if (token.isEmpty()) {
      token = new Token(start, start, TokenType.Missing)
      token.setError("Missing token, " + expectMsg)
    }
    this.tokens.push(token)
    return token
  }

  // TODO: fold this with mustPushNextToken somehow
  mustPushNextFileName(): Token {
    let start = this.position
    if (!this.macroArgMode) {
      // NOTE: for now, assume file name never in macro args
      let comment = this.stripComment()
      if (comment) {
        let token = new Token(start, start, TokenType.Missing)
        token.setError("Missing argument, expecting file path")
        this.tokens.push(token)
        this.tokens.push(comment)
        return token
      }
    }
    let token = this.veryNextFileName()
    if (token.isEmpty()) {
      token = new Token(start, start, TokenType.Missing)
      token.setError("Missing argument, expecting file path")
    }
    this.tokens.push(token)
    return token
  }

  pushNextToken(): Token {
    if (!this.macroArgMode) {
      let comment = this.stripComment()
      if (comment) {
        this.tokens.push(comment)
      }
    }
    let token = this.veryNextToken()
    if (!token.isEmpty()) {
      this.tokens.push(token)
    }
    return token
  }

  private popToken() {
    let token = this.tokens.pop()
    if (token) {
      this.position = token.start
    }
  }

  pushMissingToken(message: string): Token {
    let token = new Token(this.position, this.position, TokenType.Missing)
    token.setError(message)
    this.tokens.push(token)
    return token
  }

  peekNextToken(): Token {
    let mark = this.position
    if (!this.macroArgMode) {
      this.stripComment()
    }
    let token = this.veryNextToken()
    this.position = mark
    return token
  }

  private veryNextToken(): Token {
    const token = new Token(this.position, this.position, TokenType.Null)
    let sawDigit = false
    let sawHex = false
    let sawSymbol = false
    while (this.position < this.sourceLine.length) {

      const code = this.sourceLine.charCodeAt(this.position)

      if (code >= 0x30 && code <= 0x39) {			// 0-9
        sawDigit = true
        this.position += 1
        continue
      }

      if ((code >= 0x41 && code <= 0x46) ||		// A-F
          (code >= 0x61 && code <= 0x66)) {		// a-f
        sawHex = true
        this.position += 1
        continue
      }

      if ((code >= 0x47 && code <= 0x5A) ||		// G-Z
          (code >= 0x67 && code <= 0x7A) ||		// g-z
           // TODO: merlin allows symbols to contain any character > ":"
           //	Specifically, "?" is used in some assembly code.
           code == 0x5F ||										// _
           code == 0x3F) {										// ?
        sawSymbol = true
        this.position += 1
        continue
      }

      // TODO: for now allow backslashes in symbols, but fix this once
      //  mapped text has been coverted to using quotes instead of parens
      if (code == 0x5C) {   // \
        sawSymbol = true
        this.position += 1
        continue
      }

      const c = this.sourceLine[this.position]
      if (c == " " || c == "\t") {
        break
      }

      if (token.start == this.position) {

        // TODO: this might be a problem for Merlin macro param parsing
        // if (c == ";") {
        //   token.type = TokenType.Comment
        //   token.end = this.sourceLine.length
        //   return token
        // }

        // TODO: collect repeated operator into a single token (>>>, ++)
        token.type = TokenType.Operator
        this.position += 1
      }
      break
    }
    
    token.end = this.position
    if (token.start == token.end) {
      token.type = TokenType.Null
      return token
    }

    // NOTE: A TokenType.Symbol here could still be a single letter reserved word (X, Y, W).
    //	A TokenType.HexNumber could still be a symbol or reserved word (BAD, A, B).
    //	A TokenType.DecNumber could still be a hex number.
    //	In all cases, it's up to the caller to choose between them.

    if (sawSymbol) {
      token.type = TokenType.Symbol
    } else if (sawHex) {
      token.type = TokenType.HexNumber
    } else if (sawDigit) {
      token.type = TokenType.DecNumber
    } else {
      token.type = TokenType.Operator
    }
    return token
  }

  private skipWhiteSpace() {
    while (this.position < this.sourceLine.length) {
      const c = this.sourceLine[this.position]
      if (c != " " && c != "\t") {
        break
      }
      this.position += 1
    }
  }

  private veryNextFileName(): Token {

    const token = new Token(this.position, this.position, TokenType.Null)
    if (this.position < this.sourceLine.length) {
      let quoted = false
      if (this.sourceLine[this.position] == '"') {
        quoted = true
        this.position += 1
      }

      while (this.position < this.sourceLine.length) {
        const code = this.sourceLine.charCodeAt(this.position)
        if ((code >= 0x30 && code <= 0x39) ||			// 0-9
          (code >= 0x41 && code <= 0x5A) ||		    // A-Z
          (code >= 0x61 && code <= 0x7A) ||		    // a-z
          code == 0x5F || code == 0x2E || code == 0x2F) { // "_" or "." or "/"
          this.position += 1
          continue
        }
        if (quoted && code == 0x22) {
          this.position += 1
        }
        break
      }
    }

    token.end = this.position
    if (token.length > 0) {
      token.type = TokenType.FileName
    }
    return token
  }

  veryNextString(terminator: string): Token {
    const token = new Token(this.position, this.position, TokenType.Null)
    while (this.position < this.sourceLine.length) {
      const nextChar = this.sourceLine[this.position]
      if (nextChar == terminator) {
        break
      }
      this.position += 1
      if (nextChar == "\\") {
        if (this.position < this.sourceLine.length) {
          this.position += 1
        } else {
          // *** error if string ends with escape ***
        }
      }
    }
    token.end = this.position
    if (token.length > 0) {
      token.type = TokenType.String     // TODO: unique type?
    }
    return token
  }

  // *** consider creating a missing expression class ***
  mustParseExpression(token?: Token, recurse: boolean = true): exp.Expression | undefined {
    if (!token) {
      token = this.mustPushNextToken("expected expression")
      if (token.isEmpty()) {
        return
      }
    }
    if (token.isEmpty()) {
      token.setError("Missing expression")
      return
    }
    return this.parseExpression(token, recurse)
  }

  parseExpression(token?: Token, recurse: boolean = true): exp.Expression | undefined {
    if (!token) {
      token = this.pushNextToken()
    }
    // let startTokenIndex = this.tokens.length - 1
    let expression: exp.Expression | undefined
    let str = this.getTokenString(token)
    if (token.type == TokenType.Operator) {
      if (str == "$") {
        token.type = TokenType.HexNumber
        token = this.mustPushNextToken("expecting hex digits")
        str = this.getTokenString(token)
        if (token.type == TokenType.HexNumber || token.type == TokenType.DecNumber) {
          let value = parseInt(str, 16)
          if (value != value) {
            token.setError("Invalid hex format")
          } else {
            expression = new exp.NumberExpression(value, str.length > 2)
          }
        } else if (str != "") {
          token.setError("Invalid hex format")
        }
      } else if (str == "%") {
        token.type = TokenType.DecNumber
        token = this.mustPushNextToken("expecting binary digits")
        str = this.getTokenString(token)
        if (token.type == TokenType.DecNumber) {
          let value = parseInt(str, 2)
          if (value != value) {
            token.setError("Invalid binary format")
          } else {
            expression = new exp.NumberExpression(value, str.length > 8)
          }
        } else if (str != "") {
          token.setError("Invalid binary format")
        }
      } else if ((str == ":" && this.syntax == "MERLIN") ||
        (str == "." && this.syntax == "DASM") ||
        ((str == ">" || str == "<") && this.syntax == "LISA") ||
        str == "@") {		// TODO: scope this to a particular syntax
        let token2 = this.veryNextToken()
        //*** bad if null, what then? ***
        if (token2.isEmpty() || token2.type == TokenType.Operator) {
        	return  // ***
        }
        token.end = token2.end
        token.type = TokenType.LocalLabel
        str = this.getTokenString(token)
        //*** convert local to global name ***
        expression = new exp.SymbolExpression(str, token)
      } else if (str == "]" && this.syntax == "MERLIN") {
        expression = this.parseVarExpression(token)
      } else if (str == "<" || str == ">" || str == "-"
        || (str == "/" && this.syntax == "LISA" && recurse)) {
        let arg = this.mustParseExpression(undefined, recurse)
        if (arg) {
          expression = new exp.UnaryExpression(str, arg)
        } else {
          // *** error ***
        }
      } else if (str == "*") {
        expression = new exp.PcExpression()
      } else if (str == "(") {
        expression = this.parseExpression(this.pushNextToken(), recurse)
        if (expression) {
          token = this.pushNextToken()
          if (this.getTokenString(token) != ")") {
            //*** error
          }
          expression = new exp.ParenExpression(expression)

          // *** if USR or macro args, allow "+", "=", "-"
          // *** if macro args, allow ","
            // *** look for "X" or "Y" ***

        } else {
          // *** error
        }
      } else if (str == '"' || str == "'") {
        const highFlip = str == '"' ? 0x80 : 0x00
        const charStr = this.peekVeryNextChar()
        if (charStr == "") {
          // *** error
        }
        this.position += 1
        token.end += 1
        const endStr = this.peekVeryNextChar()
        // Merlin allows omission of closing quote on character literal
        // bool mustFindTerm = !assembler->IsMerlin() || assembler->IsStrict();
        if (endStr == "" || endStr != str) {
          // *** error
        }
        this.position += 1
        token.end += 1
        token.type = TokenType.String
        const value = charStr.charCodeAt(0) ^ highFlip
        expression = new exp.NumberExpression(value, false)
      } else if (str == ",") {
        this.popToken()   // *** also undo skipWhiteSpace?
      } else {
        token.setError("Unexpected token")
        return
      }
    } else if (token.type == TokenType.DecNumber) {
      let value = parseInt(str, 10)
      expression = new exp.NumberExpression(value, false)
    } else if (token.type == TokenType.Symbol || token.type == TokenType.HexNumber) {
      token.type = TokenType.Symbol
      str = this.getTokenString(token)
      // attempt to immediately link to a previously defined symbol
      //  (allows conditional statements to find symbols in this pass)
      const symbol = this.symbols.find(str)
      if (symbol) {
        token.symbol = symbol
        // *** add reference in symbol to statement/token? ***
      }
      expression = new exp.SymbolExpression(str, token)
    } else {
      token.setError("Invalid expression")
      return
    }

    if (recurse) {
      while (true) {
        token = this.peekNextToken()
        str = this.getTokenString(token)
        if (str == '-' || str == '+' || str == '*' || str == '/') {
          // valid for every syntax
        } else if (str == '!' || str == '.' || str == '&') {
          if (this.syntax != "MERLIN") {
            break
          }
        } else if (str == '=') {
          if (this.syntax != "DASM") {
            break
          }
        } else {
          break
        }

        // expression.setTokenRange(startTokenIndex, this.tokens.length)

        token = this.pushNextToken()    // operator token
        token = this.pushNextToken()    // first token of second expression
        let expression2: exp.Expression | undefined
        expression2 = this.parseExpression(token, false)
        //*** error check
        if (expression && expression2) {
          expression = new exp.BinaryExpression(expression, str, expression2)
        }
      }
    }

    // expression.setTokenRange(startTokenIndex, this.tokens.length)
    return expression
  }

  // caller has already checked for Merlin and that token == "]"
  parseVarExpression(token: Token) {
    let token2 = this.veryNextToken()
    // //*** bad if null, what then? ***
    // if (token2.isEmpty()) {
    //   return
    // }
    token.end = token2.end
    token.type = TokenType.Variable
    return new exp.VarExpression(this.getTokenString(token))
  }
}

//------------------------------------------------------------------------------
