
import { Parser, Token, TokenType } from "./parser"
import * as exp from "./expressions"
import * as sym from "./symbols"

//-----------------------------------------------------------------------------

export class Statement {
  protected type: string = "NONE"
  public sourceLine: string = ""
  public tokens: Token[] = []
  protected symbol?: sym.Symbol     // only if statement has label
  // protected args: string
  // protected lineIndex = -1
  // protected fileIndex = -1
  //*** flag if statement has token with error

  // scope:? SymbolScope  // only if statement starts local label scope

  init(type: string, sourceLine: string, tokens: Token[], symbol?: sym.Symbol) {
    this.type = type
    this.sourceLine = sourceLine
    this.tokens = tokens
    this.symbol = symbol
  }

  parse(parser: Parser) {
    let token = parser.pushNextToken()
    if (!token.isEmpty()) {
      parser.parseExpression(token, false)
    }
  }

  getTokenString(token: Token): string {
    return token.getString(this.sourceLine)
  }

  getTokenAt(ch: number): Token | undefined {
    for (let i = 0; i < this.tokens.length; i += 1) {
      const token = this.tokens[i]
      if (ch >= token.start && ch < token.end) {
        return token
      }
    }
  }
}

//-----------------------------------------------------------------------------

enum OpTarget {
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
  private target: OpTarget = OpTarget.NONE
  private expression: exp.Expression | undefined

  constructor(opcode: any) {
    super()
    this.opcode = opcode
  }

  parse(parser: Parser) {
    let token: Token
    if (this.opcode.NONE === undefined) {
      token = parser.mustPushNextToken("expecting opcode expression")
    } else {
      token = parser.pushNextToken()
    }
    let str = parser.getTokenStringUC(token)

    // *** check all of these against opcode addressing modes ***

    if (token.isEmpty()) {
      this.target = OpTarget.NONE
    } else if (str == "A") {
      if (this.opcode.A === undefined) {
        token.setError("Accumulator mode not allowed for this opcode")
      }
      token.type = TokenType.Opcode
      this.target = OpTarget.A
    } else if (str == "#") {
      if (this.opcode.IMM === undefined) {
        token.setError("Immediate mode not allowed for this opcode")
      }
      token.type = TokenType.Opcode
      this.target = OpTarget.IMM
      this.expression = parser.mustParseExpression()
    } else if (str == "/") {			// same as "#>"
      if (this.opcode.IMM === undefined) {
        token.setError("Immediate mode not allowed for this opcode")
      } else if (parser.syntax != "LISA") {
        token.setWarning("Syntax specific to LISA assembler")
        // TODO: would be clear to extend warning to entire expression
      }
      this.target = OpTarget.IMM
      this.expression = parser.mustParseExpression()
    } else if (str == "(") {
      // *** check opcode ***
      token.type = TokenType.Opcode
      this.expression = parser.mustParseExpression()

      token = parser.pushNextToken()
      str = parser.getTokenStringUC(token)
      if (str == ")") {
        token.type = TokenType.Opcode
  
        token = parser.pushNextToken()
        str = parser.getTokenStringUC(token)
        if (str == "") {
          if (this.opcode.IND === undefined) {
            token.setError("Indirect mode not allowed for this opcode")
          }
          this.target = OpTarget.IND
        } if (str == ",") {
          token.type = TokenType.Opcode

          token = parser.mustPushNextToken("expecting 'Y'")
          str = parser.getTokenStringUC(token)

          if (str == "Y") {
            if (this.opcode.INDY === undefined) {
              token.setError("Indirect mode not allowed for this opcode")
            }
            this.target = OpTarget.INDY
            token.type = TokenType.Opcode
          } else if (str == "X") {
            token.setError("Invalid mode, expecting 'Y'")
          } else if (str != "") {
            token.setError("Unexpected token, expecting 'Y'")
          }
        } else {
          //*** error?
        }
      } else if (str == ",") {
        token.type = TokenType.Opcode

        token = parser.mustPushNextToken("expecting 'X'")
        str = parser.getTokenStringUC(token)

        if (str == "") {
          return
        }

        if (str == "Y") {
          token.setError("Invalid mode, expecting 'X'")
        } else if (str != "X") {
          token.setError("Unexpected token, expecting 'X'")
        } else if (this.opcode.INDX === undefined) {
          token.setError("Indirect mode not allowed for this opcode")
        }

        this.target = OpTarget.INDX
        token.type = TokenType.Opcode

        token = parser.mustPushNextToken("expecting ')'")
        str = parser.getTokenStringUC(token)

        if (str == ")") {
          token.type = TokenType.Opcode
        }
      } else {
        token.setError("Unexpected token, expecting 'X'")
      }
    } else {
      this.expression = parser.mustParseExpression(token)
      // *** not needed if empty expression returned ***
      if (!this.expression) {
        return
      }

      token = parser.pushNextToken()
      str = parser.getTokenStringUC(token)
      if (str == "") {
        this.target = OpTarget.ZP
      } else if (str == ",") {
        token.type = TokenType.Opcode

        token = parser.mustPushNextToken("expecting 'X' or 'Y'")
        str = parser.getTokenStringUC(token)

        if (str == "X") {
          this.target = OpTarget.ZPX
          token.type = TokenType.Opcode
        } else if (str == "Y") {
          this.target = OpTarget.ZPY
          token.type = TokenType.Opcode
        } else if (str != "") {
          token.setError("Unexpected token, expecting 'X' or 'Y'")
        }
      } else {
        token.setError("Unexpected token, expecting ','")
      }
    }

    //*** choose address mode ***
  }
}

//-----------------------------------------------------------------------------

export class DataStatement extends Statement {

  private expressions: exp.Expression[] = []
  private bytesPerElement = 0

  parse(parser: Parser) {

    if (this.type == "DFB"
      || this.type == "DC.B"
      || this.type == ".BYTE") {
      this.type = "DB"
    } else if (this.type == "DA"
      || this.type == "DC.W"
      || this.type == ".WORD"
      || this.type == "ADR") {
      this.type = "DW"
    }

    // at this point, type is either DB, DDB, or DW

    this.expressions = []
    let bytesPerElement = this.type == "DB" ? 1 : 2
    while (true) {
      let token = parser.mustPushNextToken("expecting data expression")
      if (token.isEmpty()) {
        break
      }

      // DASM allows ".byte #<MYLABEL", for example
      // *** hiliting ***
      if (parser.getTokenString(token) == "#") {
        token = parser.pushNextToken()
      }

      let expression = parser.parseExpression(token)
      if (!expression) {
        break	// ***
      }
      //*** syntax hiliting
      //*** error handling

      this.expressions.push(expression)

      token = parser.pushNextToken()
      if (parser.getTokenString(token) == ",") {
        // *** hilite
        continue
      }

      if (!token.isEmpty()) {
        //*** missing token 
        return
      }

      break
    }
  }

  getSize(): number | undefined {
    return this.expressions.length * this.bytesPerElement
  }
}

//-----------------------------------------------------------------------------

export class EquStatement extends Statement {

  parse(parser: Parser) {
    let expression = parser.parseExpression()
    if (!expression) {
      // *** error
      return
    }
    if (!this.symbol) {
      // *** error
      return
    }

    this.symbol.expression = expression
  }

  getSize(): number | undefined {
    return this.symbol?.expression?.getSize()
  }
}

//-----------------------------------------------------------------------------

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
      if (token.isEmpty()) {
        //*** error if no token
        break
      }

      if (parser.getTokenString(token) == "$") {
        token.setError("$ prefix not allowed on HEX statements")
        token = parser.pushNextToken()
        if (token.isEmpty()) {
          //*** error if no token
          break
        }
        //*** force type to hex?
      }

      if (token.type != TokenType.DecNumber
        && token.type != TokenType.HexNumber) {
        token.setError("Hex string required")
        break
      }

      //*** force type to hex?

      let hexString = parser.getTokenStringUC(token)
      if (hexString.length & 1) {
        token.setError("Odd number of nibbles")
      } else {
        scanHex(hexString, this.dataBytes)
      }

      token = parser.pushNextToken()
      if (token.isEmpty()) {
        break
      }

      // *** TODO: this should be transparent
      if (token.type == TokenType.Comment) {
        break
      }

      if (parser.getTokenString(token) != ",") {
        token.setError("Unexpected token, expecting ','")
        break
      }
    }
  }

  getSize(): number | undefined {
    return this.dataBytes.length
  }
}

//-----------------------------------------------------------------------------

export class IncludeStatement extends Statement {

  parse(parser: Parser) {
    const token = parser.mustPushNextFileName()
    const fileName = parser.getTokenString(token)
    if (!parser.assembler.includeFile(fileName)) {
      token.setError("File not found")
    }
  }
}

//-----------------------------------------------------------------------------

// *** should this be using expressions at all? ***
  // *** numbers, symbols, ??? ***

export class MacroStatement extends Statement {

  // *** tokens instead? ***
  private args: string[] = []

  // *** capture start/end of each arg ***

  parse(parser: Parser) {
    parser.setMacroArgMode(true)

    let start = parser.getPosition()
    while (true) {
      let token = parser.pushNextToken()
      let str = parser.getTokenString(token)
      if (str == "") {
        // *** would be an error if right after ";" ***
        break
      }
      // special case parens expressions to support opcode addressing modes and USR syntax
      if (str == "(") {
        // consume expressions until ")"
        let expression = parser.parseExpression()
        while (expression) {
          token = parser.pushNextToken()
          str = parser.getTokenString(token)
          if (str == ")") {
            break
          } else if (str == "") {
            // *** error ***
          } else if (str == ",") {
            continue
          } else {
            expression = parser.mustParseExpression(token)
          }
        }

        token = parser.pushNextToken()
        str = parser.getTokenString(token)

        if (str == "") {
          break
        }
        if (str == ";") {
          // *** flush token ***
          start = parser.getPosition()
          continue
        }

        // look for USR trailing operators
        if (str == "+" || str == "=" || str == "-") {
          // ***
        } else if (str == ",") {
          // *** look for address modes ***
        } else {
          // ***
        }

        // *** if USR or macro args, allow "+", "=", "-"
        // *** if macro args, allow ","
          // *** look for "X" or "Y" ***

      } else if (str == ";") {
        // *** error, missing expression ***
      } else if (str == ",") {
        // *** look for X or Y ***
      } else {
        // *** consume expressions until "" or ";" ***
        let expression = parser.mustParseExpression(token)

      }
    }

    // let token = parser.pushNextToken()
    // if (!token.isEmpty()) {
    //   let str = parser.getTokenString(token)
    //   if (str == "(") {
    //     // *** special case parens expressions here ***
    //   } else {
    //     let expression = parser.parseExpression(token)
    //     while (expression) {
    //       token = parser.pushNextToken()
    //       str = parser.getTokenString(token)
    //       if (str == "") {
    //         break
    //       }
    //       if (str == ";") {
    //         // *** flush token ***
    //         start = parser.getPosition()
    //       }
    //       expression = parser.mustParseExpression()
    //     }
    //   }
    // }
    parser.setMacroArgMode(false)

    if (parser.getPosition() != start) {
      // *** flush token ***
    }

    // *** comments afterwards? ***
  }

  getSize(): number | undefined {
    return undefined
  }
}

//-----------------------------------------------------------------------------

export class StorageStatement extends Statement {

  private sizeArg: exp.Expression | undefined
  private patternArg: exp.Expression | undefined

  parse(parser: Parser) {

    let token = parser.mustPushNextToken("expecting storage size expression")
    if (token.isEmpty()) {
      return
    }

    //*** push token?
    if (parser.getTokenString(token) == "\\") {				//*** MERLIN-only
      this.sizeArg = new exp.AlignExpression(new exp.NumberExpression(256, false))
    } else {
      this.sizeArg = parser.mustParseExpression(token)
      // *** not needed if empty expression returned ***
      if (this.sizeArg === undefined) {
        // *** need to force "missing expression" error ***
        return
      }
      //*** error if resolved value is out of range
    }

    token = parser.pushNextToken()
    if (parser.getTokenString(token) == ",") {
      this.patternArg = parser.mustParseExpression()
      // *** not needed if empty expression returned ***
      if (!this.patternArg) {
        return
      }
    } else if (token.isEmpty()) {
      // default to filling with zero
      this.patternArg = new exp.NumberExpression(0, false)
    } else {
      token.setError("Unexpected token, expecting ','")
    }
  }

  getSize(): number | undefined {
    return this.sizeArg?.resolve()
  }
}

//-----------------------------------------------------------------------------
