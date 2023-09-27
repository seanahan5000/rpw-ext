
import { Syntax } from "./syntax"
import { Token, TokenType } from "./tokenizer"
// import { Expression, TokenExpressionSet } from "./x_expressions"
import * as exp from "./x_expressions"
import { Parser } from "./x_parser"

//------------------------------------------------------------------------------

export class Statement extends exp.Expression {

  public sourceLine: string = ""

  init(sourceLine: string, children: exp.TokenExpressionSet) {
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
      token = parser.mustGetNextToken("expecting opcode expression")
    } else {
      token = parser.getNextToken()
    }

    let str = token?.getString().toLowerCase() ?? ""
    if (str == "") {
      this.mode = OpMode.NONE
    } else if (token) {
      if (str == "a") {
        parser.pushToken(token)
        if (this.opcode.A === undefined) {
          token.setError("Accumulator mode not allowed for this opcode")
        } else if (parser.syntax && parser.syntax == Syntax.ACME) {
          token.setError("Accumulator mode not allowed for ACME syntax")
        }
        token.type = TokenType.Opcode
        this.mode = OpMode.A
      } else if (str == "#") {
        parser.pushToken(token)
        if (this.opcode.IMM === undefined) {
          token.setError("Immediate mode not allowed for this opcode")
        }
        token.type = TokenType.Opcode
        this.mode = OpMode.IMM
        parser.mustPushNextExpression()
      } else if (str == "/") {			// same as "#>"
        parser.pushToken(token)
        if (this.opcode.IMM === undefined) {
          token.setError("Immediate mode not allowed for this opcode")
        } else if (parser.syntax && parser.syntax != Syntax.LISA) {
          token.setError("Syntax specific to LISA assembler")
          // TODO: would be clearer to extend warning to entire expression
        }
        this.mode = OpMode.IMM
        parser.mustPushNextExpression()
      } else if (str == "(") {
        parser.pushToken(token)
        // *** check opcode has this address mode ***
        token.type = TokenType.Opcode
        parser.mustPushNextExpression()

        let res = parser.mustAddToken([",", ")"], TokenType.Opcode)
        if (res.index == 0) {               // (exp,X)

          res = parser.mustAddToken("x", TokenType.Opcode)
          if (res.index == 0 && res.token) {
            if (this.opcode.INDX === undefined) {
              res.token.setError("Indirect mode not allowed for this opcode")
            }
            this.mode = OpMode.INDX
            token.type = TokenType.Opcode
            parser.mustAddToken(")", TokenType.Opcode)
          }
          return

        } else if (res.index == 1) {        // (exp) or (exp),Y

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
              str = token.getString().toLowerCase()  
              if (str == "y") {
                if (this.opcode.INDY === undefined) {
                  token.setError("Indirect mode not allowed for this opcode")
                }
                token.type = TokenType.Opcode
                this.mode = OpMode.INDY
              } else if (str == "x") {
                token.setError("Invalid mode, expecting 'Y'")
              } else if (str != "") {
                token.setError("Unexpected token, expecting 'Y'")
              }
            } else {
              // *** should maybe undo this push ***
              token.setError("Unexpected token")
            }
          }
        } else {
          return
        }
      } else {
        parser.mustPushNextExpression(token)
        token = parser.pushNextToken()
        // *** premature to assign ZP when expression size isn't known ***
        if (!token) {
          this.mode = OpMode.ZP             // exp
        } else {
          if (token.getString() == ",") {   // exp,X or exp,Y
            token.type = TokenType.Opcode
            token = parser.mustPushNextToken("expecting 'X' or 'Y'")
            if (token.type != TokenType.Missing) {
              str = token.getString().toLowerCase()
              if (str == "x") {             // exp,X
                this.mode = OpMode.ZPX
                token.type = TokenType.Opcode
              } else if (str == "y") {      // exp,Y
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

class ConditionalStatement extends Statement {
  // ***
}

export class IfStatement extends ConditionalStatement {
  // ***
}

export class IfDefStatement extends ConditionalStatement {

  private defined: boolean

  constructor(defined: boolean) {
    super()
    this.defined = defined
  }

  // ***
}

export class ElseStatement extends ConditionalStatement {
  // ***
}

export class ElseIfStatement extends ConditionalStatement {
  // ***
}

export class EndIfStatement extends ConditionalStatement {
  // ***
}

//------------------------------------------------------------------------------

class DataStatement extends Statement {

  protected dataSize: number
  protected swapEndian: boolean

  constructor(dataSize: number, swapEndian = false) {
    super()
    this.dataSize = dataSize
    this.swapEndian = swapEndian
  }

  parse(parser: Parser) {
    while (true) {
      let token: Token | undefined

      token = parser.getNextToken()
      if (!token) {
        parser.addMissingToken("expecting data expression")
        break
      }

      // DASM allows ".byte #<MYLABEL", for example
      if (!parser.syntax || parser.syntax == Syntax.DASM) {
        if (token.getString() == "#") {
          parser.pushToken(token)
          token = undefined
        }
      }

      // *** token could be "," here ***

      let expression = parser.pushNextExpression(token)
      if (!expression) {
        // *** what happens to token?
        break
      }

      if (parser.mustAddToken(["", ","]).index <= 0) {
        break
      }
    }
  }
}

export class ByteDataStatement extends DataStatement {
  constructor() {
    super(1)
  }
}

export class WordDataStatement extends DataStatement {
  constructor(swapEndian = false) {
    super(2, swapEndian)
  }
}

export class StorageStatement extends Statement {

  protected dataSize: number
  protected swapEndian: boolean

  private sizeArg?: exp.Expression
  private patternArg?: exp.Expression

  constructor(dataSize: number, swapEndian = false) {
    super()
    this.dataSize = dataSize
    this.swapEndian = swapEndian
  }

  parse(parser: Parser) {
  
    let token: Token | undefined

    token = parser.mustGetNextToken("expecting storage size expression")
    // *** empty??? ***
    if (token.isEmpty()) {
      parser.pushToken(token)
      return
    }

    if (token.getString() == "\\") {
      if (!parser.syntax || parser.syntax == Syntax.MERLIN) {
        this.sizeArg = new exp.AlignExpression(new exp.NumberExpression([token], 256, false))
        parser.pushExpression(this.sizeArg)
      } else {
        parser.pushToken(token)
        token.setError("Invalid storage size")
        return
      }
    } else {
      this.sizeArg = parser.mustParseExpression(token)
      if (!this.sizeArg) {
        return
      }

      //*** error if resolved value is out of range
    }

    if (parser.mustAddToken(["", ","]).index <= 0) {
      return
    }

    this.patternArg = parser.mustParseExpression()
  }
}

export class ByteStorageStatement extends DataStatement {
  constructor() {
    super(1)
  }
}

export class WordStorageStatement extends DataStatement {
  constructor(swapEndian = false) {
    super(2, swapEndian)
  }
}

//------------------------------------------------------------------------------

export class EntryStatement extends Statement {
  // ***
}

// *** watch for assigning a value to a local label
//  *** LISA, for example, doesn't allow that
export class EquStatement extends Statement {
  // ***
}

export class ErrorStatement extends Statement {

  private errExpression?: exp.Expression

  parse(parser: Parser) {
    // *** maybe use a different variation like parseControlExpression?
    this.errExpression = parser.parseExpression()
  }

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

export class UsrStatement extends Statement {

  parse(parser: Parser) {

    while (true) {
      let token = parser.getNextToken()
      if (!token) {
        break
      }

      // *** special case () for NajaText ? ***

      // *** not on first pass ***
      const str = token.getString()
      if (str == ",") {
        parser.pushToken(token)
        continue
      }

      const expression = parser.pushNextExpression(token)
      if (!expression) {
        break
      }
    }
  }
}

//------------------------------------------------------------------------------

// TODO: probably needs to be split by syntax

export class MacroStatement extends Statement {

  parse(parser: Parser) {

    while (true) {
      let token = parser.getNextToken()
      if (!token) {
        break
      }

      const str = token.getString()

      // *** special case () for NajaText ? ***

      // *** merlin-only ***
      // *** not on first pass ***
      if (str == ";") {
        parser.pushToken(token)
        continue
      }

      const expression = parser.pushNextExpression(token)
      if (!expression) {
        break
      }

      // *** what about "," ?
    }
  }

  // ***
}

//------------------------------------------------------------------------------
