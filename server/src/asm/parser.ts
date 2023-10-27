
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

import { SourceFile } from "./project"
import { Node, Token, TokenType, Tokenizer } from "./tokenizer"
import { Opcodes6502 } from "./opcodes"
import { Syntax, SyntaxMap, SyntaxDefs, SyntaxDef, OpDef, Op } from "./syntax"
import { SymbolType, SymbolFrom } from "./symbols"
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

  public parseStatements(sourceFile: SourceFile, lines: string[]) {
    const statements = []
    this.sourceFile = sourceFile
    this.lineNumber = 0
    this.syntax = sourceFile.module.project.syntax
    // *** macro begin/end tracking ***
    while (this.lineNumber < lines.length) {
      this.setSourceLine(lines[this.lineNumber])
      statements.push(this.parseStatement())
      this.lineNumber += 1
    }
    return statements
  }


  private parseStatement(): stm.Statement {

    this.nodeSet = []
    this.nodeSetStack = []
    this.labelExp = undefined
    let statement: stm.Statement | undefined

    // check for a comment first so Merlin's '*' comment special case gets handled
    this.pushNextComment()

    let symVarExp = this.parseSymbol(true)
    if (symVarExp) {
      this.addExpression(symVarExp)
      if (symVarExp instanceof exp.SymbolExpression) {
        this.labelExp = symVarExp
      } else if (symVarExp instanceof exp.VarExpression) {
        statement = this.initStatement(new stm.VarStatement(), this.getNextToken())
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
    statement.parse(this)

    // handle extra tokens
    // *** don't generate more errors if this already has an error ***
    let token = this.getNextToken()
    if (token) {
      const extraTokens: Token[] = []
      do {
        token.setError("Unexpected token")
        extraTokens.push(token)
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
    {
      const symValue = statement.labelExp?.symbol?.getValue()
      if (!symValue) {
        statement.labelExp?.symbol?.setValue(new exp.PcExpression(), SymbolFrom.Statement)
      }
    }

    return statement
  }

  private parseKeyword(token: Token): stm.Statement | undefined {
    let statement: stm.Statement | undefined
    let keywordLC = token.getString().toLowerCase()

    // ACME syntax uses '!' prefix for keywords
    if (keywordLC == "!") {
      if (!this.syntax || this.syntax == Syntax.ACME) {
        const nextToken = this.getVeryNextToken()
        if (nextToken) {
          token.end = nextToken.end
          token.type = TokenType.Symbol
          keywordLC = token.getString().toLowerCase()
        }
      }
    } else if (keywordLC == "}") {
      // ACME syntax ends conditionals, zones, and other blocks with '}'
      if (!this.syntax || this.syntax == Syntax.ACME) {
        const elseToken = this.peekNextToken()
        if (elseToken) {
          if (elseToken.getString().toLowerCase() == "else") {
            statement = new stm.ElseStatement()
          }
        } else {
          // TODO: end correct current group type (!if, !zone, etc.)
          statement = new stm.EndIfStatement()
        }
      }
    }

    if (!statement) {
      let keyword: any
      for (let i = 1; i < SyntaxDefs.length; i += 1) {
        if (!this.syntax || i == this.syntax) {
          const k = SyntaxDefs[i].keywordMap.get(keywordLC)
          if (k) {
            if (keyword && !k.create) {
              continue
            }
            keyword = k
            // TODO: Count number of matches and track likelySyntax
            //  based on keyword matches in only one syntax.
            //  Could change likelySyntax for each line?
            if (this.syntax) {
              break
            }
            // when syntax unknown, keep matching so match counts are balanced
          }
        }
      }
      if (keyword) {
        token.type = TokenType.Keyword
        if (keyword.create) {
          statement = keyword.create()
        } else {
          // TODO: remove this and make all syntax table entries create the correct type
          statement = new stm.GenericStatement()
        }
      }
    }

    if (statement) {
      return this.initStatement(statement, token)
    }
  }


  private parseOpcode(token: Token): stm.Statement | undefined {
    let opNameLC = token.getString().toLowerCase()
    let opcode = (Opcodes6502 as {[key: string]: any})[opNameLC]
    if (opcode !== undefined) {
      token.type = TokenType.Opcode
      return this.initStatement(new stm.OpStatement(opcode), token)
    }
  }

  private parseMacroInvoke(token: Token): stm.Statement | undefined {
    this.startExpression()
    if (token.getString() == "+") {
      this.addToken(token)
      if (!this.syntax || this.syntax == Syntax.ACME) {
        token.type = TokenType.Macro
        const nextToken = this.getVeryNextToken()
        if (nextToken) {
          token = nextToken
          token.type = TokenType.Macro
        } else {
          token.setError("Expecting macro name")
        }
      } else {
        token.setError("Unexpected token")
      }
    }
    this.addToken(token)
    if (token.type != TokenType.Symbol && token.type != TokenType.HexNumber) {
      token.setError("Unexpected token")
    }
    const symExp = this.newSymbolExpression(this.endExpression(), SymbolType.Macro, false)
    return this.initStatement(new stm.MacroInvokeStatement(), symExp)
  }

  private initStatement(statement: stm.Statement, opTokenExp?: Token | exp.Expression) {
    if (opTokenExp) {
      if (opTokenExp instanceof Token) {
        opTokenExp = new exp.Expression([opTokenExp])
      }
      this.addExpression(opTokenExp)
    }
    statement.init(this.sourceLine, this.endExpression(), this.labelExp, opTokenExp)
    return statement
  }

  // *** keep count of local types and directive matches to determine syntax ***

  private parseSymbol(isDefinition: boolean, token?: Token):
    exp.SymbolExpression | exp.VarExpression | undefined {

    if (isDefinition) {
      const nextChar = this.peekVeryNextChar()
      if (!nextChar) {
        return
      }

      if (nextChar == "!" || nextChar == "}" || nextChar == "*") {
        if (!this.syntax || this.syntax == Syntax.ACME){
          return
        }
      }

      const savedPosition = this.position
      // *** mark start and back up on some failures ***

      if (nextChar == " " || nextChar == "\t") {    // *** tabs?

        // detect indented variable assignment but exclude
        //  "*=$1000" syntax for setting org
        if (!this.syntax || this.syntax == Syntax.ACME) {
          const t1 = this.getNextToken()
          const t2 = this.peekNextToken()
          if (!t1 || !t2 || t1.getString() == "*" || t2.getString() != "=") {
            this.position = savedPosition
            return
          }
          token = t1
        } else {
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
    if (str == "]") {
      if (!this.syntax || this.syntax == Syntax.MERLIN) {
        // *** enforce/handle var assignment
          // peekNextToken == "=" ?
        return this.parseVarExpression(token)
      }
    }

    // a token that starts with a "." could be a local or a keyword
    //  depending on the syntax
    if (token.type == TokenType.Symbol && str[0] == ".") {
      // *** maybe duplicate in parseValueExpression?
      // if (isDefinition) {
        // turn the token into a single character "." and back up
        // *** TODO: add logic to decide when to do this ***
        token.type = TokenType.Operator
        token.end = token.start + 1
        this.position = token.end
        str = "."
      // }
    }

    if (token.type == TokenType.Operator) {

      if (isDefinition) {
        if (str == "^") {
          if (!this.syntax || this.syntax == Syntax.LISA) {
            return this.parseLisaLocal(token, isDefinition)
          }
        } else if ((str[0] == "-" || str[0] == "+")
            && (str[0] == str[str.length - 1])) {
          if (!this.syntax || this.syntax == Syntax.ACME) {
            if (str.length > 9) {
              token.setError("Anonymous local is too long")
              return new exp.BadExpression([token])
            }
            // *** maybe macro invocation in first column? ***
            // *** must be whitespace/eol afterwards to be label?
            token.type = TokenType.Label
            return this.newSymbolExpression([token], SymbolType.AnonLocal, isDefinition)
          }
        }
      }

      if (str == ".") {
        // *** could be directive in first column ***
        if (!this.syntax ||
            this.syntax == Syntax.DASM ||
            this.syntax == Syntax.ACME) {       // *** what others?
          return this.parseLocal(token, SymbolType.ZoneLocal, isDefinition)
        }
      } else if (str == ":") {
        if (!this.syntax ||
            this.syntax == Syntax.MERLIN) {   // *** any others?
          return this.parseLocal(token, SymbolType.CheapLocal, isDefinition)
        }
      } else if (str == "@") {
        if (!this.syntax ||
            this.syntax == Syntax.ACME ||
            this.syntax == Syntax.CA65) {       // *** what others?
          return this.parseLocal(token, SymbolType.CheapLocal, isDefinition)
        }
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

      if (str == "::") {
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
        if (token.type != TokenType.Symbol &&
          token.type != TokenType.HexNumber) {
          token.setError("Unexpected token, expecting symbol name")
          return new exp.BadExpression(this.endExpression())
        }

        token.type = TokenType.Symbol

        const nextChar = this.peekVeryNextChar()
        if (nextChar != ":") {
          break
        }

        // *** this.pushVeryNextToken()
        token = this.getVeryNextToken()
        if (!token) {
          break
        }

        this.addToken(token)
        str = token.getString()

        if (str == "::") {
          if (this.syntax && this.syntax != Syntax.CA65) {
            token.setError("Unexpected token")
            return new exp.BadExpression(this.endExpression())
          }
        } else {
          if (this.syntax /*&& this.syntax != Syntax.SBASM*/) {
            token.setError("Unexpected token")
            return new exp.BadExpression(this.endExpression())
          }
        }

        // TODO: what type should scoping colons be?
        token.type = TokenType.Keyword
        localType = SymbolType.Scoped

        // *** this.pushVeryNextToken()
        token = this.getVeryNextToken()
        if (!token) {
          this.addMissingToken("expected symbol name")
          return new exp.BadExpression(this.endExpression())
        }

        this.addToken(token)
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
    const nextChar = this.peekVeryNextChar()
    if (nextChar == ":") {
      const token = this.addNextToken()
      if (token) {
        // TODO: change token.type to what?
        if (this.syntax &&
          this.syntax != Syntax.ACME &&
          this.syntax != Syntax.CA65) {
          token.setError("Not allowed for this syntax")
        }
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

  parseLisaLocal(token: Token, isDefinition: boolean): exp.Expression {
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

  // *** what happens to token if not used?
    // *** force this.position = token.end ???
  public parseValueExpression(token: Token): exp.Expression | undefined {
    let str = token.getString()
    if (token.type == TokenType.Operator) {
      if (str == "$" || str == "%") {
        return this.parseNumberExpression(token)
      }
      if (str == "*") {
        token.type = TokenType.Keyword
        return new exp.PcExpression(token)
      }
      if (str == '"' || str == "'") {
        // *** how to choose between string literals and strings? ***
        // *** pick these values dynamically ***
        const allowEscapes = true
        const allowUnterminated = false
        return this.parseStringExpression(token, allowEscapes, allowUnterminated)
      }
      if (str == "!") {
        // *** LISA supports '!' prefix for decimal numbers, including "!-9"
        // *** could be keyword
        // *** otherwise, return nothing
        return
      }
      if (str == ":" || str == "::") {
        // *** possible cheap locals (MERLIN)
        // *** possible macro local (SBASM)
        // *** possible macro divider (ACME)
        return this.parseSymbol(false, token)
      }
      if (str == "@") {
        // *** possible cheap locals
        return this.parseSymbol(false, token)
      }

      // NOTE: #>, #< (LISA) and ++,-- (ACME) are handled in OpStatement parsing

      // *** what about str == "." ???
      if (str[0] == ".") {
        // *** look for keywords before looking for symbols ***
        // if not keyword, split off '.'
        // *** parse symbol
        // *** if not symbol, ???
        return this.parseSymbol(false, token)
      }
      if (str == "]") {
        if (!this.syntax || this.syntax == Syntax.MERLIN) {
          return this.parseVarExpression(token)
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

  parseStringExpression(quoteToken: Token, allowEscapes = true, allowUnterminated = false): exp.StringExpression {

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

    return new exp.StringExpression(this.endExpression())
  }

 getNextFileNameExpression(): exp.FileNameExpression | undefined {

    this.skipWhitespace()
    const startPosition = this.position
    if (this.position < this.sourceLine.length) {

      let quoteChar = this.sourceLine[this.position]
      if (quoteChar == '"' || quoteChar == "'") {
        // TODO: enforce/allow quotes for only some syntaxes?
        this.position += 1
      } else {
        quoteChar = ""
      }

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
        if (nextChar == quoteChar) {
          this.position += 1
        }
        break
      }
    }

    if (this.position > startPosition) {
      const token = new Token(this.sourceLine, startPosition, this.position, TokenType.FileName)
      return new exp.FileNameExpression(token)
    }
  }

  // caller has already checked for Merlin and that token == "]"
  parseVarExpression(bracketToken: Token): exp.VarExpression {
    bracketToken.type = TokenType.Variable
    const nameToken = this.mustGetVeryNextToken("expecting var name")
    if (nameToken.type != TokenType.Symbol
      && nameToken.type != TokenType.HexNumber
      && nameToken.type != TokenType.DecNumber)
    {
      nameToken.setError("Unexpected token, expecting var name")
    }

    nameToken.type = TokenType.Variable
    return new exp.VarExpression([bracketToken, nameToken])
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

            if (opEntry.precedence > nextOp.precedence ||
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
