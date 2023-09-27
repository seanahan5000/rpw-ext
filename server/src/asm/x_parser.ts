
// MERLIN
  // label starts in first column
  // locals start with ':'
  // no operator precedence (left to right)
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
// LISA
// SBASM
  // keywords start with '.'
  // trailing ':' on labels is optional
  // label name should be followed by a white space or EOL

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

import { Assembler, LineRecord } from "./assembler"
import { Tokenizer, Token, TokenType } from "./tokenizer"
import { Opcodes6502 } from "./opcodes"
import { Syntax, SyntaxDefs, SyntaxDef, OpDef, Op } from "./syntax"
import * as exp from "./x_expressions"
import * as stm from "./x_statements"

//------------------------------------------------------------------------------

class OpEntry {
  public token: Token
  public op: Op
  public precedence: number
  public rightAssoc: boolean
  public isUnary: boolean

  constructor(token: Token, opDef: OpDef, unary: boolean) {
    this.token = token
    this.op = opDef.op
    this.precedence = opDef.pre
    this.rightAssoc = opDef.ra ?? false
    this.isUnary = unary
  }
}

class EvalState {
  public opStack: OpEntry[] = []          // Infix to Postfix conversion
  public expStack: exp.Expression[] = []  // Postfix evaluation
  public lastSeen?: (OpEntry | exp.Expression)
  public tokenExpSet: exp.TokenExpressionSet = []
  public parenStack: Token[] = []
}

export class Parser extends Tokenizer {

  public assembler: Assembler

  private evalState: EvalState
  private evalStack: EvalState[]

  constructor(assembler: Assembler) {
    super()
    this.assembler = assembler

    // dummy until initLine is called
    this.evalState = new EvalState()
    this.evalStack = []
  }

  private initLine(sourceLine: string) {
    this.setSourceLine(sourceLine)
  
    this.evalState = new EvalState()
    this.evalStack = []
  }

  // push/pop the current expression to/from the expressionStack
  // *** move these ***

  private startExpression(token?: Token) {
    // *** save start position for possible revert? ***
    this.evalStack.push(this.evalState)
    this.evalState = new EvalState()
    if (token) {
      this.pushToken(token)
    }
  }

  private endExpression(): exp.TokenExpressionSet {
    const result = this.evalState.tokenExpSet
    const prevState = this.evalStack.pop()
    // NOTE: don't pop the last state because that's the statement itself
    if (prevState) {
      this.evalState = prevState
    }
    return result
  }

  // push tokens and expression onto the current parent expression
  // *** use "add" instead of "push" ***

  pushToken(token: Token) {
    this.evalState.tokenExpSet.push(token)
  }

  mustPushNextToken(expectMsg: string): Token {
    const token = this.mustGetNextToken(expectMsg)
    this.pushToken(token)
    return token
  }

  mustPushVeryNextToken(expectMsg: string): Token {
    const token = this.mustGetVeryNextToken(expectMsg)
    this.pushToken(token)
    return token
  }

  pushNextToken(): Token | undefined {
    const token = this.getNextToken()
    if (token) {
      this.pushToken(token)
    }
    return token
  }

  // Given a string or array of strings, attempt to parse and push
  //  a token matching one of them.  On success, return index of matching
  //  string.  On failure, push missing token and return -1.
  //  When matching an empty string, no token is pushed.

  mustAddToken(possible: string | string[], type?: TokenType): { index: number, token?: Token} {
    const strings = typeof possible == "string" ? [possible] : possible
    const token = this.pushNextToken()
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
    const start = this.position
    const token = new Token(this.sourceLine, start, start, TokenType.Missing)
    token.setError("Missing token, " + message)
    this.pushToken(token)
    return token
  }

  // *** pushVeryNextToken ***

  pushExpression(expression: exp.Expression) {
    this.evalState.tokenExpSet.push(expression)
  }

  mustPushNextExpression(token?: Token): exp.Expression {
    const expression = this.mustParseExpression(token)
    this.pushExpression(expression)
    return expression
  }

  pushNextExpression(token?: Token): exp.Expression | undefined {
    const expression = this.parseExpression(token)
    if (expression) {
      this.pushExpression(expression)
    }
    return expression
  }

  // *** if parsing fails with general syntax, try again using likelySyntax ***
  parseStatement(lineRecord: LineRecord, sourceLine: string) {

    let statement: stm.Statement | undefined

    this.initLine(sourceLine)

    // if (!this.conditional.isEnabled()) {
      // *** conditional checks
    // }

    // check for a comment first so Merlin's '*' comment special case gets handled
    this.pushNextComment()

    let labelExpression = this.parseLabel(true)
    if (labelExpression) {
      this.pushExpression(labelExpression)
    }

    statement = this.parseOpcode()
    if (!statement) {
      statement = new stm.Statement()
    }

    statement.init(/*statementType,*/ sourceLine, this.endExpression()/*, symbol*/)
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
      this.pushExpression(new exp.ErrorExpression(extraTokens))
    }

    // handle possible comment at end of statement
    // *** getting pushed twice ***
    this.pushNextComment()

    lineRecord.statement = statement
  }

  private parseOpcode(): stm.Statement | undefined {

    let token = this.getNextToken()
    if (!token) {
      return
    }

    // ACME syntax uses '!' prefix for keywords and '+' for macro invocations
    let statementType = token.getString().toLowerCase()
    if (statementType == "!" || statementType == "+") {
      if (!this.syntax || this.syntax == Syntax.ACME) {
        const nextToken = this.getVeryNextToken()
        if (nextToken) {
          token.end = nextToken.end
          token.type = TokenType.Symbol
          statementType = token.getString().toLowerCase()
        }
      }
    } else if (statementType == "}") {
      // *** this probably shouldn't be done here ***
      // ACME syntax ends conditions and other blocks with '}'
      if (!this.syntax || this.syntax == Syntax.ACME) {
        // TODO: process end block
        // *** push token ***
        return
      }
    }

    this.pushToken(token)

    let opcode = (Opcodes6502 as {[key: string]: any})[statementType]
    if (opcode !== undefined) {
      token.type = TokenType.Opcode
      return new stm.OpStatement(opcode)
    }

    let keyword: any
    for (let i = 1; i < SyntaxDefs.length; i += 1) {
      if (!this.syntax || i == this.syntax) {
        const k = SyntaxDefs[i].keywordMap.get(statementType)
        if (k !== undefined) {
          keyword = k
          // *** count match ***
          // *** track likelySyntax by keyword matches in only one syntax
          // *** could change likelySyntax for each line?
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
        return keyword.create()
      }
      // *** if no create, then keyword not associated with a statement was found
      return
    }

    if (token.type == TokenType.Operator) {
      token.setError("Unexpected token")
      return
    }

    const firstChar = statementType[0]

    if (firstChar == "!" || firstChar == ".") {
      token.setError("Unknown keyword")
      return
    }

    if (firstChar == "+") {
      // *** intentional macro invocation
    } else {
      // TODO: look through known macros first
    }

    token.type = TokenType.Macro
    return new stm.MacroStatement()
  }

  // *** keep count of local types and directive matches to determine syntax ***

  private parseLabel(definition: boolean, token?: Token): exp.Expression | undefined {

    if (definition) {
      const nextChar = this.peekVeryNextChar()
      if (!nextChar) {
        return
      }

      if (nextChar == "!" || nextChar == "}") {
        if (!this.syntax || this.syntax == Syntax.ACME){
          return
        }
      }

      const savedPosition = this.position
      // *** mark start and back up on some failures ***
  
      if (nextChar == " " || nextChar == "\t") {    // *** tabs?

        // detect indented variable assignment
        if (!this.syntax || this.syntax == Syntax.ACME) {
          const t1 = this.getNextToken()
          const t2 = this.peekNextToken()
          if (!t1 || !t2 || t2.getString() != "=") {
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

    // a token that starts with a "." could be a local or a keyword
    //  depending on the syntax
    let str = token.getString()
    if (token.type == TokenType.Symbol && str[0] == ".") {
      if (definition) {
        // turn the token into a single character "." and back up
        // *** TODO: add logic to decide when to do this ***
        token.type = TokenType.Operator
        token.end = token.start + 1
        this.position = token.end
        str = "."
      }
    }

    let nextType: TokenType | undefined
    this.startExpression(token)

    if (token.type == TokenType.Operator) {
      if (str == ":") {
        // *** could be global scope in first column? ***
        token.type = TokenType.LocalLabelPrefix
        nextType = TokenType.LocalLabel
        if (this.syntax &&
            this.syntax != Syntax.MERLIN) {   // *** any others?
          token.setError("Not supported in this syntax")
        }
      } else if (str == "]") {
        // *** increment Merlin syntax counter ***
        token.type = TokenType.VariablePrefix
        nextType = TokenType.Variable
        if (this.syntax &&
            this.syntax != Syntax.MERLIN) {
          token.setError("Not supported in this syntax")
        }
      } else if (str == ".") {
        // *** could be directive in first column ***
        token.type = TokenType.LocalLabelPrefix
        nextType = TokenType.LocalLabel
        if (this.syntax &&
            this.syntax != Syntax.DASM &&
            this.syntax != Syntax.ACME) {       // *** what others?
          token.setError("Not supported in this syntax")
        }
      } else if (str == "@") {
        token.type = TokenType.LocalLabelPrefix
        nextType = TokenType.LocalLabel
        if (this.syntax &&
            this.syntax != Syntax.CA65) {       // *** what others?
          token.setError("Not supported in this syntax")
        }
      } else if ((str[0] == "-" || str[0] == "+")
          && (str[0] == str[str.length - 1])) {
        // *** maybe macro invocation in first column? ***
        // *** must be whitespace/eol afterwards to be label?
        token.type = TokenType.LocalLabelPrefix
        if (this.syntax &&
            this.syntax != Syntax.ACME) {       // *** what others?
          token.setError("Not supported in this syntax")
        }
      } else if ((str == ">" || str == "<") && !definition) {
        // *** shouldn't do this if already doing # immediate operation
        // *** must be whitespace/eol afterwards?
        token.type = TokenType.LocalLabelPrefix
        if (this.syntax &&
            this.syntax != Syntax.LISA) {       // *** what others?
          token.setError("Not supported in this syntax")
        }
      } else {
        // *** error
      }
    } else {
      if (token.type != TokenType.Symbol &&
        token.type != TokenType.HexNumber &&
        token.type != TokenType.DecNumber) {
        //*** maybe back up and fail instead? ***
        token.setError("Unexpected token, expecting label name")
      } else {
        token.type = TokenType.Label
      }
    }

    if (nextType) {
      token = this.mustGetVeryNextToken("expecting label name")
      this.pushToken(token)
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
    }

    if (token.type == TokenType.Variable) {
      // *** enforce/handle var assignment
        // peekNextToken == "=" ?
      return new exp.VarExpression(this.endExpression())
    }

    if (definition) {
      const nextChar = this.peekVeryNextChar()
      if (nextChar == ":") {
        if (!this.syntax || this.syntax == Syntax.ACME) {
          const token = this.pushNextToken()
          if (token) {
            // TODO: change token.type to what?
          }
        }
      }
    }

    if (!definition) {
      // *** parse fully scoped
    }
  
    const expression = new exp.LabelExpression(this.endExpression())

    // *** trailing whitespace?
    // *** special syntax logic ***

    // *** scoping? ***
    // *** build symbol ***
    // *** build Label/VarExpression and return ***
    // *** single character labels/locals ***

    return expression
  }

  mustParseExpression(token?: Token): exp.Expression {
    if (!token) {
      token = this.mustGetNextToken("expected expression")
    }
    if (token.type == TokenType.Missing) {
      return new exp.ErrorExpression([token])
    }

    let start = this.position
    let expression = this.parseExpression(token)
    if (!expression) {
      // *** token = new Token(this.sourceLine, start, start, TokenType.Missing)
      token.setError("Expected expression")
      expression = new exp.ErrorExpression([token])
    }
    return expression
  }

  private parseOperator(token: Token, isUnary: boolean): OpEntry | undefined {
    const syntax: SyntaxDef = SyntaxDefs[this.syntax]
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

  // *** needs cleanup pass for new parser ***
  private parseValueExpression(token: Token): exp.Expression | undefined {
    let str = token.getString()
    if (token.type == TokenType.Operator) {
      if (str == "$" || str == "%") {
        return this.parseNumberExpression(token)
      }
      if (this.isLocalPrefix(str)) {
        // *** if (str == ".") look for keywords first ***
        return this.parseLabel(false, token)
      }
      // *** what about unknown?
      if (str == "]") {
        if (!this.syntax || this.syntax == Syntax.MERLIN) {
          return this.parseVarExpression(token)
        }
        return
      }
      if (str == "*") {
        return new exp.PcExpression(token)
      }
      // *** here or elsewhere? ***
      if (str == "(") {
        return this.parseParenExpression(token)
      }
      if (str == '"' || str == "'") {
        // *** how to choose between string literals and strings? ***
        // *** pick these values dynamically ***
        const allowEscapes = true
        const allowUnterminated = false
        return this.parseStringExpression(token, allowEscapes, allowUnterminated)
      } else if (str == ",") {
        // ***
      }
      return
    }
    if (token.type == TokenType.DecNumber) {
      return this.parseNumberExpression(token)
    }
    if (token.type == TokenType.Symbol || token.type == TokenType.HexNumber) {
      // *** expression = parseSymbolReference(token)
      // *** maybe extend symbol scope ***
      token.type = TokenType.Symbol
      str = token.getString()
      // *** scoping ***
      // *** symbol linking if possible ***
      return new exp.SymbolExpression(str, token)
    }

    //*** what happens to token here? ***
  }

  // http://www.neocomputer.org/projects/lang/infix.html

  // *** pass in hint about type of expression
  // *** flush parse stack ***
  // *** mustParseExpression ***

  parseExpression(inToken?: Token): exp.Expression | undefined {

    //*** pass inToken?
    this.startExpression()

    // consume operators and expressions in Infix order and process them on Postfix order
    while (true) {

      const token = inToken ? inToken : this.getNextToken()
      inToken = undefined
      if (!token) {
        break
      }

      let isUnary = true
      // *** affected by parens ***
      if (this.evalState.lastSeen) {
        if (this.evalState.lastSeen instanceof exp.Expression) {
          isUnary = false
        }
      }

      // *** deal with merlin "." operator versus symbols here ***

      // *** search for scoped label first? ***

      // *** deal with paired operators (parens,backets,braces)

      // *** what about "," or other expression enders?

      const nextOp = this.parseOperator(token, isUnary)
      if (nextOp) {
        this.evalState.lastSeen = nextOp

        // *** if token is open paren/brace/bracket

        // *** if token is close paren/brace/bracket

        if (nextOp.isUnary) {
          // *** does this handle unary ops of different precedence? ***
          if (nextOp.rightAssoc) {
            this.evalState.opStack.push(nextOp)
          } else {
            this.processOperator(nextOp)
            // *** error condition? ***
          }
        } else {
          while (true) {
            const opEntry = this.evalState.opStack.pop()
            if (!opEntry) {
              break
            }

            if (opEntry.precedence > nextOp.precedence ||
              (nextOp.rightAssoc && opEntry.precedence == nextOp.precedence)) {
                this.processOperator(opEntry)
                // *** if in error state, break
            } else {
              this.evalState.opStack.push(opEntry)
              break
            }

            this.processOperator(opEntry)
            // *** if in error state, break
          }

          // *** what if error above? ***
          this.evalState.opStack.push(nextOp)
        }
      } else {
        // values/operands are always pushed to output stack
        const nextExp = this.parseValueExpression(token)
        if (!nextExp) {
          // *** for now, stop and back up at any unknown token ***
          this.position = token.start
          break
        }

        this.evalState.lastSeen = nextExp
        this.evalState.expStack.push(nextExp)
      }
    }

    // process remaining ops on stack
    while (true) {
      const opEntry = this.evalState.opStack.pop()
      if (!opEntry) {
        break
      }
      this.processOperator(opEntry)
      // *** error condition? ***
    }

    // expression stack holds top-level expression
    let expression = this.evalState.expStack.pop()
    if (!expression) {
      // *** error ***
      return
    }

    // there shouldn't be anything left on expression stack
    if (this.evalState.expStack.length != 0) {
      // *** error ***
      return
    }

    this.endExpression()
    return expression
  }

  private processOperator(opEntry: OpEntry) {
    if (opEntry.isUnary) {
      let arg = this.evalState.expStack.pop()
      if (!arg) {
        // *** error ***
        return
      }
      this.evalState.expStack.push(new exp.UnaryExpression(opEntry.token, opEntry.op, arg))
    } else {
      let arg2 = this.evalState.expStack.pop()
      let arg1 = this.evalState.expStack.pop()
      if (!arg1 || !arg2) {
        // *** error ***
        return
      }
      this.evalState.expStack.push(new exp.BinaryExpression(arg1, opEntry.token, opEntry.op, arg2))
    }
  }


  // *** need to pass in token?
  // OLD_parseExpression(token?: Token, recurse: boolean = true): exp.Expression | undefined {
  //   if (!token) {
  //     token = this.getNextToken()
  //     // *** check this
  //     if (!token) {
  //       return
  //     }
  //   }

  //   let expression: exp.Expression | undefined
  //   let str = token.getString()
  //   if (token.type == TokenType.Operator) {
  //     if (str == "$" || str == "%") {
  //       expression = this.parseNumberExpression(token)
  //     } else if (this.isLocalPrefix(str)) {
  //       // *** if (str == ".") look for keywords first ***
  //       expression = this.parseLabel(false, token)
  //     } else if (str == "]" && this.syntax == Syntax.MERLIN) {
  //       expression = this.parseVarExpression(token)
  //     } else if (str == "<" || str == ">" || str == "-"
  //       || (str == "/" && this.syntax == Syntax.LISA && recurse)) {
  //       // *** need to apply precendence ***
  //       let arg = this.mustParseExpression(/*undefined, recurse*/)
  //       if (arg) {
  //         expression = new exp.UnaryExpression(token, arg)
  //       } else {
  //         // *** error ***
  //       }
  //     } else if (str == "*") {
  //       expression = new exp.PcExpression(/*token*/)
  //     } else if (str == "(") {
  //       expression = this.parseParenExpression(token)
  //     } else if (str == '"' || str == "'") {
  //       // *** how to choose between string literals and strings? ***
  //       // *** pick these values dynamically ***
  //       const allowEscapes = true
  //       const allowUnterminated = false
  //       expression = this.parseStringExpression(token, allowEscapes, allowUnterminated)
  //     } else if (str == ",") {
  //       // ***
  //     } else {
  //       // token.setError("Unexpected token")
  //       return
  //     }
  //   } else if (token.type == TokenType.DecNumber) {
  //     expression = this.parseNumberExpression(token)
  //   } else if (token.type == TokenType.Symbol || token.type == TokenType.HexNumber) {
  //     // *** expression = parseSymbolReference(token)
  //     // *** maybe extend symbol scope ***
  //     token.type = TokenType.Symbol
  //     str = token.getString()
  //     // *** scoping ***
  //     // *** symbol linking if possible ***
  //     expression = new exp.SymbolExpression(str, token)
  //   } else {
  //     // ***
  //     // token.setError("Invalid expression")
  //     return
  //   }

  //   if (recurse) {
  //     while (true) {
  //       token = this.peekNextToken()
  //       if (!token) {
  //         break
  //       }
  //       const str = token.getString()
  //       if (str == '-' || str == '+' || str == '*' || str == '/') {
  //         // valid for every syntax
  //       } else if (str == "=") {
  //         if (this.syntax
  //           && this.syntax != Syntax.DASM
  //           && this.syntax != Syntax.ACME) {
  //           break
  //         }
  //       //*** more here
  //       } else {
  //         break
  //       }

  //       const opToken = this.getNextToken()   // operator token
  //       if (opToken) {
  //         let expression2: exp.Expression | undefined
  //         expression2 = this.OLD_parseExpression(undefined, false)
  //         //*** error check
  //         if (expression && expression2) {
  //           expression = new exp.BinaryExpression(expression, opToken, expression2)
  //         }
  //       }
  //     }
  //   }

  //   return expression
  // }

  // *** revisit ***
  // *** some assemblers use '.' prefix for keywords, not labels
  private isLocalPrefix(str: string): boolean {
    if (str == ":") {
      return !this.syntax || this.syntax == Syntax.MERLIN
    }
    if (str == ".") {
      // *** others here ***
      return !this.syntax || this.syntax == Syntax.DASM
    }
    if (str == ">" || str == "<") {
      // *** others here? ***
      return !this.syntax || this.syntax == Syntax.LISA
    }
    if (str == "@") {
      // *** others here? ***
      return !this.syntax || this.syntax == Syntax.CA65
    }
    return false
  }

  parseNumberExpression(token: Token): exp.NumberExpression {
    let value = NaN
    let forceLong = false

    this.startExpression(token)
    let str = token.getString()
    if (str == "$") {
      // *** should "$" be HexNumber or left as Operator?
      token.type = TokenType.HexNumber
      token = this.mustPushNextToken("expecting hex digits")
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
      token = this.mustPushNextToken("expecting binary digits")
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
  //
  // *** consider a token builder class to simplify/share this logic ***

  parseStringExpression(quoteToken: Token, allowEscapes = true, allowUnterminated = false): exp.StringExpression {

    quoteToken.type = TokenType.Quote
    this.startExpression(quoteToken)
    const terminator = quoteToken.getString()

    let token = new Token(this.sourceLine, this.position, this.position, TokenType.String)
    while (token.end < this.sourceLine.length) {
      const nextChar = this.sourceLine[token.end]
      if (nextChar == terminator) {
        // close string if any, and add terminator token
        if (!token.isEmpty()) {
          this.pushToken(token)
          this.position = token.end
        }
        token = new Token(this.sourceLine, this.position, this.position + 1, TokenType.Quote)
        break
      }
      if (nextChar == "\\" && allowEscapes) {
        // close string if any, and add character escape token
        if (!token.isEmpty()) {
          this.pushToken(token)
          this.position = token.end
        }
        token = new Token(this.sourceLine, this.position, this.position + 1, TokenType.Escape)
        if (token.end == this.sourceLine.length) {
          token.setError("Unterminated character escape")
          break
        }
        token.end += 1
        this.pushToken(token)
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
    this.pushToken(token)
    this.position = token.end

    // *** look for errors in constructor and mark expression?
    return new exp.StringExpression(this.endExpression())
  }

  parseParenExpression(parenToken: Token): exp.Expression {
    this.startExpression(parenToken)
    // const recurse = true    // *** always?
    // *** use this.mustPushExpression?
    const expression = this.parseExpression(/*undefined, recurse*/)
    if (expression) {
      // *** use new this.pushExpression() ***
      this.pushExpression(expression)
    }
    const token = this.mustPushNextToken("expecting ')")
    if (token.getString() != ")") {
      token.setError("Unexpected token, expecting ')'")
    }
    return new exp.ParenExpression(this.endExpression())
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
            // if found, don't treat it as a merlin line comment
            return
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
          for (let i = 1; i < SyntaxDefs.length; i += 1) {
            const syntaxName: string = Syntax[i]
            if (syntaxName == name) {
              this.syntax = i
              break
            }
          }
        }
      }

      this.position = this.sourceLine.length
      this.pushToken(token)
    }
  }
}

//------------------------------------------------------------------------------
