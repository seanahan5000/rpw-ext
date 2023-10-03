
import { Syntax } from "./syntax"
import { Token, TokenType } from "./tokenizer"
import { SymbolType, SymbolFrom } from "./symbols"
import { Assembler } from "./assembler"
import { Parser } from "./x_parser"
import * as exp from "./x_expressions"

//------------------------------------------------------------------------------

export class Statement extends exp.Expression {

  public sourceLine: string = ""

  public labelExp?: exp.SymbolExpression
  public opToken?: Token

  init(sourceLine: string, opToken: Token | undefined, children: exp.TokenExpressionSet, labelExp?: exp.SymbolExpression) {
    this.sourceLine = sourceLine
    this.opToken = opToken
    this.children = children
    this.labelExp = labelExp
  }

  parse(parser: Parser) {
    // TODO: does this default implementation still make sense?
    // TODO: just eat expressions? do nothing instead?
    const token = parser.getNextToken()
    if (token) {
      const expression = parser.parseExpression(token)
      if (expression) {
        this.children.push(expression)
      }
    }
  }

  // TODO: should any statement need resolve() or getSize()?
}

//------------------------------------------------------------------------------

// "subroutine" and ".zone" support
export class ZoneStatement extends Statement {

  parse(parser: Parser) {
    if (!this.labelExp) {
      this.labelExp = new exp.SymbolExpression([], SymbolType.Simple, true,
        parser.sourceFile, parser.lineNumber)
      this.children.unshift(this.labelExp)
    }
    this.labelExp.isZoneStart = true
  }
}

//==============================================================================
// Opcodes
//==============================================================================

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

  // *** maybe split this out into a separate callable/shareable function? ***

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
          // *** don't bother with this message ***
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

        // handle special case branch/jump labels

        const nameUC = this.opToken?.getString().toUpperCase() ?? ""

        if (this.opcode.BRAN || (this.opcode.ABS &&
            (nameUC == "JMP" || nameUC == "JSR"))) {

          // *** move to parser ***

          const isDefinition = false
          if (str == ">" || str == "<") {
            if (!parser.syntax || parser.syntax == Syntax.LISA) {
              parser.pushExpression(parser.parseLisaLocal(token, isDefinition))
              return
            }
          } else if ((str[0] == "-" || str[0] == "+")
              && (str[0] == str[str.length - 1])) {
            if (!parser.syntax || parser.syntax == Syntax.ACME) {
              if (str.length > 9) {
                token.setError("Anonymous local is too long")
                parser.pushExpression(new exp.BadExpression([token]))
                return
              }
              token.type = TokenType.LocalLabelPrefix
              parser.pushExpression(parser.newSymbolExpression([token], SymbolType.AnonLocal, isDefinition))
              return
            }
          }
        }

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

//==============================================================================
// Conditionals
//==============================================================================

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

//==============================================================================
// Storage
//==============================================================================

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

//------------------------------------------------------------------------------

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
      this.sizeArg = parser.mustPushNextExpression(token)
      if (!this.sizeArg) {
        return
      }

      //*** error if resolved value is out of range
    }

    if (parser.mustAddToken(["", ","]).index <= 0) {
      return
    }

    this.patternArg = parser.mustPushNextExpression()
  }
}

export class ByteStorageStatement extends StorageStatement {
  constructor() {
    super(1)
  }
}

export class WordStorageStatement extends StorageStatement {
  constructor(swapEndian = false) {
    super(2, swapEndian)
  }
}

//------------------------------------------------------------------------------

// NOTE: caller has checked for odd nibbles
function scanHex(hexString: string, buffer: number[]) {
  while (hexString.length > 0) {
    let byteStr = hexString.substring(0, 2)
    buffer.push(parseInt(byteStr, 16))
    hexString = hexString.substring(2)
  }
}

export class HexStatement extends Statement {
  private dataBytes: number[] = []

  parse(parser: Parser) {
    while (true) {
      let token = parser.pushNextToken()
      if (!token) {
        parser.addMissingToken("Hex value expected")
        break
      }

      let hexString = token.getString().toUpperCase()
      // *** TODO: which syntaxes is the true for? ***
      if (hexString == "$") {
        token.setError("$ prefix not allowed on HEX statements")
        token = parser.pushNextToken()
        if (!token) {
          break
        }
        hexString = token.getString().toUpperCase()
      }

      token.type = TokenType.HexNumber
      if (hexString.length & 1) {
        token.setError("Odd number of nibbles")
      } else {
        scanHex(hexString, this.dataBytes)
      }

      token = parser.pushNextToken()
      if (!token) {
        break
      }

      if (token.getString() != ",") {
        token.setError("Unexpected token, expecting ','")
        break
      }
    }
  }

  getSize(): number | undefined {
    return this.dataBytes.length
  }
}

//==============================================================================
// Disk
//==============================================================================

export class IncludeStatement extends Statement {
  parse(parser: Parser) {
    const token = parser.mustPushNextFileName()
    const fileName = token.getString()
    if (fileName != "" && !parser.assembler.includeFile(fileName)) {
      token.setError("File not found")
    }
  }
}

export class SaveStatement extends Statement {

  private fileName?: string

  parse(parser: Parser) {
    const token = parser.mustPushNextFileName()
    this.fileName = token.getString()
  }
}

//------------------------------------------------------------------------------

// *** watch for assigning a value to a local label
//  *** LISA, for example, doesn't allow that
// *** SBASM requires resolvable value with no forward references
// *** mark symbol as being assigned rather than just a label?
export class EquStatement extends Statement {

  private value?: exp.Expression

  parse(parser: Parser) {
    if (!this.labelExp) {
      this.opToken?.setError("Missing label")
      return
    }

    this.value = parser.mustPushNextExpression()
    this.labelExp.symbol?.setValue(this.value, SymbolFrom.Equate)
  }
}

export class VarStatement extends Statement {

  private value?: exp.Expression

  parse(parser: Parser) {

    if (this.opToken?.getString() != "=") {
      this.opToken?.setError("Expecting '='")
      return
    }

    this.value = parser.mustPushNextExpression()
  }
}

//------------------------------------------------------------------------------

export class EntryStatement extends Statement {
  // ***
}

export class ErrorStatement extends Statement {

  private errExpression?: exp.Expression

  parse(parser: Parser) {
    // *** maybe use a different variation like parseControlExpression?
    this.errExpression = parser.parseExpression()
    if (this.errExpression) {
      parser.pushExpression(this.errExpression)
    }
  }

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

      if (str == "(") {
        const strExpression = parser.parseStringExpression(token, true, false)
        parser.pushExpression(strExpression)
        continue

        // *** attempt NajaText
        // *** attempt 6502 addressing
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

// *** macro invoke, not definition ***
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

      if (str == "(") {
        // *** must at least one ";" before doing this??? ***
        const strExpression = parser.parseStringExpression(token, true, false)
        parser.pushExpression(strExpression)
        continue

        // *** attempt NajaText
        // *** attempt 6502 addressing
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
