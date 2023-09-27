
import { Token, TokenType, Syntax } from "./tokenizer"
import { Parser } from "./x_parser"
import { Expression } from "./x_expressions"

//------------------------------------------------------------------------------

export class Statement extends Expression {

  public sourceLine: string = ""

  init(sourceLine: string, children: (Token | Expression)[]) {
    this.sourceLine = sourceLine
    this.children = children
  }

  parse(parser: Parser) {
    // TODO: does this default implementation still make sense?
    // TODO: just eat expressions? do nothing instead?
    const token = parser.getNextToken()
    if (token) {
      const expression = parser.parseExpression(token)
      if (expression) {
        this.children?.push(expression)
      }
    }
  }

  // in children array: label, op, args, comment
  // getLabel: Expression | undefined -- or just string?
  // getOp: Expression | undefined -- or just string?
  // getArgs: Expression | undefined

  // *** resolve to array of bytes?

  // resolve (?)
  // getSize

  // *** add getExpressionAt()?
}

//------------------------------------------------------------------------------

enum OpMode {
  NONE,
  A,
  IMM,
  ZP,
  ZPX,
  ZPY,
  ABS,
  ABSX,
  ABSY,
  IND,
  INDX,
  INDY,
  BRANCH
}

export class OpStatement extends Statement {

  private opcode: any
  private mode: OpMode = OpMode.NONE

  constructor(opcode: any) {
    super()
    this.opcode = opcode
  }

  parse(parser: Parser) {
    let token: Token | undefined

    if (this.opcode.NONE === undefined) {
      token = parser.mustPushNextToken("expecting opcode expression")
    } else {
      token = parser.pushNextToken()
    }

    let str = token?.getString().toUpperCase() ?? ""
    if (str == "") {
      this.mode = OpMode.NONE
    } else if (token) {
      if (str == "A") {
        if (this.opcode.A === undefined) {
          token.setError("Accumulator mode not allowed for this opcode")
        } else if (parser.syntax && parser.syntax == Syntax.ACME) {
          token.setError("Accumulator mode not allowed for ACME syntax")
        }
        token.type = TokenType.Opcode
        this.mode = OpMode.A
      } else if (str == "#") {
        if (this.opcode.IMM === undefined) {
          token.setError("Immediate mode not allowed for this opcode")
        }
        token.type = TokenType.Opcode
        this.mode = OpMode.IMM
        parser.mustPushExpression()
      } else if (str == "/") {			// same as "#>"
        if (this.opcode.IMM === undefined) {
          token.setError("Immediate mode not allowed for this opcode")
        } else if (parser.syntax && parser.syntax != Syntax.LISA) {
          token.setError("Syntax specific to LISA assembler")
          // TODO: would be clearer to extend warning to entire expression
        }
        this.mode = OpMode.IMM
        parser.mustPushExpression()
      } else if (str == "(") {
        // *** check opcode has this address mode ***
        token.type = TokenType.Opcode
        parser.mustPushExpression()
        token = parser.mustPushNextToken("expecting ',' or ')'")
        str = token.getString()
        if (str == ",") {               // (exp,X)
          token.type = TokenType.Opcode
          token = parser.mustPushNextToken("expecting 'X'")
          str = token.getString().toUpperCase()
          if (str == "Y") {
            token.setError("Invalid mode, expecting 'X'")
          } else if (str != "X") {
            token.setError("Unexpected token, expecting 'X'")
          } else if (this.opcode.INDX === undefined) {
            token.setError("Indirect mode not allowed for this opcode")
          }
          this.mode = OpMode.INDX
          if (token.type != TokenType.Missing) {
            token.type = TokenType.Opcode
          }
          token = parser.mustPushNextToken("expecting ')'")
          str = token.getString()
          if (str == ")") {
            token.type = TokenType.Opcode
          } else if (str != "") {
            token.setError("Unexpected token, expecting ')'")
          }
        } else if (str == ")") {        // (exp) or (exp),Y
          token.type = TokenType.Opcode
          let nextToken = parser.pushNextToken()
          if (!nextToken) {
            if (this.opcode.IND === undefined) {
              token.setError("Indirect mode not allowed for this opcode")
            }
            this.mode = OpMode.IND
          } else {
            token = nextToken
            str = token.getString()
            if (str == ",") {
              token.type = TokenType.Opcode
              token = parser.mustPushNextToken("expecting 'Y'")
              str = token.getString().toUpperCase()  
              if (str == "Y") {
                if (this.opcode.INDY === undefined) {
                  token.setError("Indirect mode not allowed for this opcode")
                }
                token.type = TokenType.Opcode
                this.mode = OpMode.INDY
              } else if (str == "X") {
                token.setError("Invalid mode, expecting 'Y'")
              } else if (str != "") {
                token.setError("Unexpected token, expecting 'Y'")
              }
            } else {
              // *** should maybe undo this push ***
              token.setError("Unexpected token")
            }
          }
        } else if (str != "") {
          token.setError("Unexpected token, expecting ',' or ')'")
        }
      } else {
        parser.mustPushExpression()
        token = parser.pushNextToken()
        // *** premature to assign ZP when expression size isn't known ***
        if (!token) {
          this.mode = OpMode.ZP             // exp
        } else {
          if (token.getString() == ",") {   // exp,X or exp,Y
            token.type = TokenType.Opcode
            token = parser.mustPushNextToken("expecting 'X' or 'Y'")
            if (token.type != TokenType.Missing) {
              str = token.getString().toUpperCase()
              if (str == "X") {             // exp,X
                this.mode = OpMode.ZPX
                token.type = TokenType.Opcode
              } else if (str == "Y") {      // exp,Y
                this.mode = OpMode.ZPY
                token.type = TokenType.Opcode
              } else if (str != "") {
                token.setError("Unexpected token, expecting 'X' or 'Y'")
              }
            }
          } else {
            token.setError("Unexpected token, expecting ','")
          }
        }
      }
    }
    // ***
  }
}

//------------------------------------------------------------------------------

export class ConditionalStatement extends Statement {
  // ***
}

export class DataStatement extends Statement {
  // ***
}

export class EntryStatement extends Statement {
  // ***
}

export class EquStatement extends Statement {
  // ***
}

export class ErrorStatement extends Statement {
  // ***
}

export class HexStatement extends Statement {
  // ***
}

export class IncludeStatement extends Statement {
  // ***
}

export class SaveStatement extends Statement {
  // ***
}

export class StorageStatement extends Statement {
  // ***
}

export class UsrStatement extends Statement {
  // ***
}

//------------------------------------------------------------------------------
