
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

//-----------------------------------------------------------------------------

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
    this.errorType = TokenErrorType.Error
    this.errorMessage = message
  }

  setWarning(message: string) {
    this.errorType = TokenErrorType.Warning
    this.errorMessage = message
  }

  setInfo(message: string) {
    this.errorType = TokenErrorType.Info
    this.errorMessage = message
  }

  static Null: Token = new Token(0, 0, TokenType.Null)
}

//-----------------------------------------------------------------------------

// *** Parser extends a separate Tokenizer class? ***
export class Parser {

  public assembler: asm.Assembler
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

  getTokenString(token: Token): string {
    return token.getString(this.sourceLine)
  }

  getTokenStringUC(token: Token): string {
    return token.getString(this.sourceLineUC)
  }

  getPosition(): number {
    return this.position
  }

  setMacroArgMode(enable: boolean) {
    if (enable) {
      // skip initialize whitespace before args
      this.skipWhiteSpace()
    }
    this.macroArgMode = enable
  }

  parseStatement(lineRecord: asm.LineRecord, sourceLine: string) {

    this.setSourceLine(lineRecord, sourceLine)

    let symbol = this.parseLabel()

    let statement: stm.Statement | undefined
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

  private peekVeryNextChar(): string {
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
        let start = token.start
        
        let token2 = this.veryNextToken()
        //*** bad if null, what then? ***
        // if (token2.isEmpty()) {
        // 	return
        // }
        token.end = token2.end
        token.type = TokenType.LocalLabel
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
        // *** parse string
      } else {
        // *** mark token as invalid?
        // *** what about ";" of macro args?
        // *** what about "," of arg list?
        this.popToken()   // *** also undo skipWhiteSpace?
      }
    } else if (token.type == TokenType.DecNumber) {
      let value = parseInt(str, 10)
      expression = new exp.NumberExpression(value, false)
    } else if (token.type == TokenType.Symbol || token.type == TokenType.HexNumber) {
      token.type = TokenType.Symbol
      // *** is token.type correct here?
      // *** upper or lower case symbol?
      expression = new exp.SymbolExpression(this.getTokenString(token), token.type)
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
}

//-----------------------------------------------------------------------------
