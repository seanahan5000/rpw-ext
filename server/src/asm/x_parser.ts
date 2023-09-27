
// MERLIN
  // label starts in first column
  // locals start with ':'
  // no operator precedence
// DASM
  // scoped with SUBROUTINE
  // locals start with '.'
// CA65
  // keywords start with '.'
  // label starts in first column, ends with ':'
  // locals start with '@'
  // has named scopes, using ':', '::' for global scope
// ACME
  // keywords start with '!'
  // locals start with '.'
  // scoped with !zone
  // {} groups
  // does not allow "LSR A" -- just "LSR"
  // has operator precendence
  // +/- branches
  // +name to invoke macro
  // '.' and '#' in binary values
  // indented everything (labels)
  // *=$9999 to set org (any column)
// SBASM
  // keywords start with '.'
  // trailing ':' on labels is optional
  // label name should be followed by a white space or EOL
// LISA

import * as asm from "./assembler"
import { Tokenizer, Token, TokenType, Syntax } from "./tokenizer"
import { Opcodes6502 } from './opcodes'
import { Keywords } from './keywords'
import * as exp from "./x_expressions"
import * as stm from "./x_statements"

//------------------------------------------------------------------------------

export class Parser extends Tokenizer {

  public assembler: asm.Assembler
  private children: (Token | exp.Expression)[] = []

  constructor(assembler: asm.Assembler) {
    super()
    this.assembler = assembler
  }

  protected setSourceLine(sourceLine: string) {
    super.setSourceLine(sourceLine)
    this.children = []
    // *** more here
  }

  mustPushNextToken(expectMsg: string): Token {
    const token = this.mustGetNextToken(expectMsg)
    this.children.push(token)
    return token
  }

  pushNextToken(): Token | undefined {
    const token = this.getNextToken()
    if (token) {
      this.children.push(token)
    }
    return token
  }

  mustPushExpression(): exp.Expression {
    const expression = this.mustParseExpression()
    this.children.push(expression)
    return expression
  }

  pushExpression(): exp.Expression | undefined {
    const expression = this.parseExpression()
    if (expression) {
      this.children.push(expression)
    }
    return expression
  }

  parseStatement(lineRecord: asm.LineRecord, sourceLine: string) {

    let statement: stm.Statement | undefined

    this.setSourceLine(sourceLine)

    // if (!this.conditional.isEnabled()) {
      // *** conditional checks
    // }

    // check for a comment first so Merlin's '*' comment special case gets handled
    let comment = this.parseComment()
    if (comment) {
      this.children.push(comment)
    }

    let labelExpression = this.parseLabel(true)
    if (labelExpression) {
      this.children.push(labelExpression)
    }

    statement = this.parseOpcode()
    if (!statement) {
      statement = new stm.Statement()
    }

    statement.init(/*statementType,*/ sourceLine, this.children/*, symbol*/)
    statement.parse(this)

    // handle extra tokens
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
      this.children.push(new exp.ErrorExpression(extraTokens))
    }

    // handle possible comment at end of statement
    comment = this.parseComment()
    if (comment) {
      this.children.push(comment)
    }

    lineRecord.statement = statement
  }

  private parseOpcode(): stm.Statement | undefined {

    let token = this.getNextToken()
    if (!token) {
      return
    }

    this.children.push(token)
    let statementType = token.getString().toUpperCase()

    let opcode = (Opcodes6502 as {[key: string]: any})[statementType]
    if (opcode !== undefined) {
      token.type = TokenType.Opcode
      return new stm.OpStatement(opcode)
    }

    let keyword: any
    for (let i = 1; i < Keywords.length; i += 1) {
      if (!this.syntax || i == this.syntax) {
        const keywordSet = (Keywords as {[key: string]: any})[i]
        const k = (keywordSet as {[key: string]: any})[statementType]
        if (k !== undefined) {
          keyword = k
          // *** count match ***
          if (this.syntax) {
            break
          }
          // when syntax unknown, keep matching so match counts are balanced
        }
      }
    }
    if (keyword !== undefined) {
      token.type = TokenType.Keyword
      if (keyword.create) {
        return keyword.create()
      }
      // *** if no create, then keyword not associated with a statement was found
    }

    //*** more
  }

  // *** keep count of local types and directive matches to determine syntax ***

  private parseLabel(definition: boolean): exp.Expression | undefined {

    const nextChar = this.peekVeryNextChar()
    if (!nextChar) {
      return
    }

    const savedPosition = this.position
    // *** mark start and back up on some failures ***

    if (definition) {
      if (nextChar == " " || nextChar == "\t") {    // *** tabs?
        // *** more logic to deal with indented labels for some syntaxes ***
          // *** look for = after label ***
        return
      }
    }

    let token = this.getNextToken()
    if (!token) {
      return
    }

    const tokens: Token[] = [token]
    let nextType: TokenType | undefined

    if (token.type == TokenType.Operator) {
      const value = token.getString()
      if (value == ":") {
        // *** could be global scope in first column? ***
        token.type = TokenType.LocalLabelPrefix
        nextType = TokenType.LocalLabel
        if (this.syntax &&
            this.syntax != Syntax.MERLIN) {   // *** any others?
          token.setError("Not supported in this syntax")
        }
      } else if (value == "]") {
        // *** increment Merlin syntax counter ***
        token.type = TokenType.VariablePrefix
        nextType = TokenType.Variable
        if (this.syntax &&
            this.syntax != Syntax.MERLIN) {
          token.setError("Not supported in this syntax")
        }
      } else if (value == ".") {
        // *** could be directive in first column ***
        token.type = TokenType.LocalLabelPrefix
        nextType = TokenType.LocalLabel
        if (this.syntax &&
            this.syntax != Syntax.DASM &&
            this.syntax != Syntax.ACME) {       // *** what others?
          token.setError("Not supported in this syntax")
        }
      } else if (value == "@") {
        token.type = TokenType.LocalLabelPrefix
        nextType = TokenType.LocalLabel
        if (this.syntax &&
            this.syntax != Syntax.CA65) {       // *** what others?
          token.setError("Not supported in this syntax")
        }
      } else if ((value[0] == "-" || value[0] == "+")
          && (value[0] == value[value.length - 1])) {
        // *** maybe macro invocation in first column? ***
        // *** must be whitespace/eol afterwards to be label?
        token.type = TokenType.LocalLabelPrefix
        if (this.syntax &&
            this.syntax != Syntax.ACME) {       // *** what others?
          token.setError("Not supported in this syntax")
        }
      } else if ((value == ">" || value == "<") && !definition) {
        // *** must be whitespace/eol afterwards?
        token.type = TokenType.LocalLabelPrefix
        if (this.syntax &&
            this.syntax != Syntax.LISA) {       // *** what others?
          token.setError("Not supported in this syntax")
        }
      } else {
        // *** error
      }
    }

    if (nextType) {
      token = this.mustGetVeryNextToken("expecting label name")
      tokens.push(token)
    } else {
      nextType = TokenType.Label
    }

    if (token.type != TokenType.Missing) {
      if (token.type != TokenType.Symbol &&
          token.type != TokenType.HexNumber &&
          token.type != TokenType.DecNumber) {
        //*** maybe back up and fail instead? ***
        token.setError("Unexpected token, expecting label name")
      } else {
        token.type = nextType
      }
    }

    let expression: exp.Expression | undefined

    if (token.type == TokenType.Variable) {
      expression = new exp.VarExpression(tokens)
      // *** enforce var assignment
        // peekNextToken == "=" ?
    } else {
      expression = new exp.LabelExpression(tokens)
    }

    if (!definition) {
      // *** parse fully scoped
    }

    // *** trailing colon?
      // *** separate token from label
    // *** trailing whitespace?

    // *** special syntax logic ***

    // *** scoping? ***
    // *** build symbol ***
    // *** build Label/VarExpression and return ***

    return expression
  }

  mustParseExpression(token?: Token, recurse: boolean = true): exp.Expression {
    if (!token) {
      token = this.mustGetNextToken("expected expression")
    }
    if (token.type == TokenType.Missing) {
      return new exp.ErrorExpression([token])
    }

    let start = this.position
    let expression = this.parseExpression(token, recurse)
    if (!expression) {
      token = new Token(this.sourceLine, start, start, TokenType.Missing)
      token.setError("Expected expression")
      expression = new exp.ErrorExpression([token])
    }
    return expression
  }

  parseExpression(token?: Token, recurse: boolean = true): exp.Expression | undefined {
    if (!token) {
      token = this.getNextToken()
      // *** check this
      if (!token) {
        return
      }
    }

    let expression: exp.Expression | undefined
    let str = token.getString()
    if (token.type == TokenType.Operator) {
      if (str == "$" || str == "%") {
        expression = this.parseNumberExpression(token)
      } else if (this.isLocalPrefix(str)) {
        // *** local label formats ***
      } else if (str == "]" && this.syntax == Syntax.MERLIN) {
        expression = this.parseVarExpression(token)
      } else if (str == "<" || str == ">" || str == "-"
        || (str == "/" && this.syntax == Syntax.LISA && recurse)) {
        // ***
      } else if (str == "*") {
        expression = new exp.PcExpression(/*token*/)
      } else if (str == "(") {
        // ***
      } else if (str == '"' || str == "'") {
        // *** how to choose between string literals and strings? ***
        // *** pick these values dynamically ***
        const allowEscapes = true
        const allowUnterminated = false
        expression = this.parseStringExpression(token, allowEscapes, allowUnterminated)
      } else if (str == ",") {
        // ***
      } else {
        // token.setError("Unexpected token")
        return
      }
    } else if (token.type == TokenType.DecNumber) {
      expression = this.parseNumberExpression(token)
    } else if (token.type == TokenType.Symbol || token.type == TokenType.HexNumber) {
      // ***
    } else {
      // ***
      // token.setError("Invalid expression")
      return
    }

    if (recurse) {
      while (true) {
        token = this.peekNextToken()
        if (!token) {
          break
        }
        const str = token.getString()
        if (str == '-' || str == '+' || str == '*' || str == '/') {
          // valid for every syntax
        //*** more here
        } else {
          break
        }
      }

      const opToken = this.getNextToken()   // operator token
      token = this.pushNextToken()          // first token of second expression
      let expression2: exp.Expression | undefined
      expression2 = this.parseExpression(token, false)
      //*** error check
      if (expression && expression2) {
        expression = new exp.BinaryExpression(expression, opToken, expression2)
      }
    }

    return expression
  }

  // *** revisit ***
  // *** some assemblers use '.' prefix for keywords, not labels
  private isLocalPrefix(str: string) {
   return ((str == ":" && this.syntax == Syntax.MERLIN) ||
    (str == "." && this.syntax == Syntax.DASM) ||
    ((str == ">" || str == "<") && this.syntax == Syntax.LISA) ||
    str == "@")		// TODO: scope this to a particular syntax
  }

  parseNumberExpression(token: Token): exp.NumberExpression {
    const tokens: Token[] = []
    let value = NaN
    let forceLong = false

    let str = token.getString()
    if (str == "$") {
      // *** should "$" be HexNumber or left as Operator?
      token.type = TokenType.HexNumber
      tokens.push(token)
      token = this.mustGetNextToken("expecting hex digits")
      tokens.push(token)
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
      token.type = TokenType.DecNumber
      tokens.push(token)
      token = this.mustGetNextToken("expecting binary digits")
      tokens.push(token)
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
      tokens.push(token)
      value = parseInt(str, 10)
      forceLong = value > 256 || value < -127
    }
    return new exp.NumberExpression(tokens, value, forceLong)
  }

  // Collect all tokens of a string, including opening quote,
  //  actual text, escape characters and terminating quote.
  //
  // *** consider a token builder class to simplify/share this logic ***

  parseStringExpression(quoteToken: Token, allowEscapes = true, allowUnterminated = false): exp.StringExpression {
    const tokens: Token[] = []

    quoteToken.type = TokenType.Quote
    tokens.push(quoteToken)
    const terminator = quoteToken.getString()

    let token = new Token(this.sourceLine, this.position, this.position, TokenType.String)
    while (token.end < this.sourceLine.length) {
      const nextChar = this.sourceLine[token.end]
      if (nextChar == terminator) {
        // close string if any, and add terminator token
        if (!token.isEmpty()) {
          tokens.push(token)
          this.position = token.end
        }
        token = new Token(this.sourceLine, this.position, this.position + 1, TokenType.Quote)
        break
      }
      if (nextChar == "\\" && allowEscapes) {
        // close string if any, and add character escape token
        if (!token.isEmpty()) {
          tokens.push(token)
          this.position = token.end
        }
        token = new Token(this.sourceLine, this.position, this.position + 1, TokenType.Escape)
        if (token.end == this.sourceLine.length) {
          token.setError("Unterminated character escape")
          break
        }
        token.end += 1
        tokens.push(token)
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
    tokens.push(token)
    this.position = token.end

    // *** look for errors in constructor and mark expression?
    return new exp.StringExpression(tokens)
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

  private parseComment(): Token | undefined {
    // special case Merlin '*' line comments
    // NOTE: peekNextChar won't work here because it stops at comment
    if (this.position == 0 && this.sourceLine[0] == "*") {
      if (!this.syntax) {
        // *** look at contents to figure it out ***
        // *** possibly return
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
        for (let i = 1; i < Keywords.length; i += 1) {
          const syntaxName: string = Syntax[i]
          if (syntaxName == name) {
            this.syntax = i
            break
          }
        }
      }
    }

    return token
  }
}

//------------------------------------------------------------------------------
