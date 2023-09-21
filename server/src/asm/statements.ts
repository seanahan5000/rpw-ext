
import { Parser, Token, TokenType } from "./parser"
import * as exp from "./expressions"
import * as sym from "./symbols"

//------------------------------------------------------------------------------

export class Statement {
  public type: string = "NONE"
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

  postParse() {
  }

  // *** consider putting string in token ***
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
  private expression?: exp.Expression

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
      this.mode = OpMode.NONE
    } else if (str == "A") {
      if (this.opcode.A === undefined) {
        token.setError("Accumulator mode not allowed for this opcode")
      }
      token.type = TokenType.Opcode
      this.mode = OpMode.A
    } else if (str == "#") {
      if (this.opcode.IMM === undefined) {
        token.setError("Immediate mode not allowed for this opcode")
      }
      token.type = TokenType.Opcode
      this.mode = OpMode.IMM
      this.expression = parser.mustParseExpression()
    } else if (str == "/") {			// same as "#>"
      if (this.opcode.IMM === undefined) {
        token.setError("Immediate mode not allowed for this opcode")
      } else if (parser.syntax != "LISA") {
        token.setWarning("Syntax specific to LISA assembler")
        // TODO: would be clear to extend warning to entire expression
      }
      this.mode = OpMode.IMM
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
          this.mode = OpMode.IND
        } if (str == ",") {
          token.type = TokenType.Opcode

          token = parser.mustPushNextToken("expecting 'Y'")
          str = parser.getTokenStringUC(token)

          if (str == "Y") {
            if (this.opcode.INDY === undefined) {
              token.setError("Indirect mode not allowed for this opcode")
            }
            this.mode = OpMode.INDY
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

        this.mode = OpMode.INDX
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

      // *** seems premature to assign ZP when expression size isn't known ***
      token = parser.pushNextToken()
      str = parser.getTokenStringUC(token)
      if (str == "") {
        this.mode = OpMode.ZP
      } else if (str == ",") {
        token.type = TokenType.Opcode

        token = parser.mustPushNextToken("expecting 'X' or 'Y'")
        str = parser.getTokenStringUC(token)

        if (str == "X") {
          this.mode = OpMode.ZPX
          token.type = TokenType.Opcode
        } else if (str == "Y") {
          this.mode = OpMode.ZPY
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

  postParse() {
    // use opcode information to infer symbol type
    if (this.expression) {
      // *** reorder for efficiency ***

      // for now, only look at simple SymbolExpressions
      let token = (this.expression as any).token
      if (token && token.symbol) {
        const size = this.expression.getSize()
        if (size == 1) {
          // *** watch out for error conditions ***
          if (this.mode == OpMode.IMM) {
            token.symbol.type = sym.SymbolType.Constant
          } else if (this.mode == OpMode.INDX
              || this.mode == OpMode.INDY
              || this.mode == OpMode.ZP
              || this.mode == OpMode.ZPX
              || this.mode == OpMode.ZPY) {
            token.symbol.type = sym.SymbolType.ZPage
          }
        }
      }
    }
  }
}

//------------------------------------------------------------------------------

// *** how to handle this while in macro definition?

export class ConditionalStatement extends Statement {

  private expression?: exp.Expression
  private nextConditional?: ConditionalStatement

  parse(parser: Parser) {

    //*** check for label on everything but DO ***

    if (this.type == "IF" || this.type == "DO" || this.type == "ELIF") {

      this.expression = parser.mustParseExpression()
      if (!this.expression) {
        //*** error
        return
      }

      let value = this.expression.resolve()
      if (value === undefined) {
        value = 0     // ***
      //   //*** error
      //   return
      }

      // *** test IF/THEN and ELIF/THEN syntax
      if (this.type != "DO") {
        const token = parser.mustPushNextToken('expecting THEN')
        if (parser.getTokenStringUC(token) != "THEN") {
          token.setError("Unexpected token, expecting THEN")
        } else {
          token.type = TokenType.Keyword
        }
      }

      if (this.type == "IF" || this.type == "DO") {

        if (!parser.conditional.push()) {
          // *** assembler->SetError("Exceeded nested conditionals maximum");
          return
        }

        parser.conditional.statement = this

        if (value != 0) {
          parser.conditional.setSatisfied(true)
          parser.conditional.enable()
        }

      } else /* if (this.type == "ELIF")*/ {

        // if (p->ConditionalsComplete())
        // {
        //   assembler->SetError("Unexpected ELIF without IF");
        //   return;
        // }

        if (parser.conditional.statement) {
          parser.conditional.statement.nextConditional = this
        } else {
          // *** error if no matching IF/DO/ELIF statement
        }
        parser.conditional.statement = this

        if (parser.conditional.isSatisfied() && value != 0) {
          parser.conditional.setSatisfied(true)
          parser.conditional.enable()
        } else {
          parser.conditional.disable()
        }
      }

    } else if (this.type == "ELSE") {

      // if (p->Next() != 0)
      // {
      //   assembler->SetError("Unexpected token after ELSE");
      //   return;
      // }

      // if (p->ConditionalsComplete())
      // {
      //   assembler->SetError("Unexpected ELSE without IF");
      //   return;
      // }

      if (parser.conditional.statement) {
        parser.conditional.statement.nextConditional = this
      } else {
        // *** error if no matching IF/DO/ELIF statement
      }
      parser.conditional.statement = this

      if (!parser.conditional.isSatisfied()) {
        parser.conditional.setSatisfied(true)
        parser.conditional.enable()
      } else {
        parser.conditional.disable()
      }
    } else /*if (this.type == "ENDIF" || this.type == "FIN")*/ {

      // if (p->Next() != 0)
      // {
      //   assembler->SetError("Unexpected token after FIN/ENDIF");
      //   return;
      // }

      if (parser.conditional.statement) {
        parser.conditional.statement.nextConditional = this
      } else {
        // *** error if no matching IF/DO/ELIF statement
      }

      if (!parser.conditional.pull()) {
        // Merlin ignores unused FIN
        // if (!assembler->SetMerlinWarning("Unexpected FIN/ENDIF"))
        // {
        //   return;
        // }
      }
    }
  }
}

//------------------------------------------------------------------------------

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

//------------------------------------------------------------------------------

export class ErrorStatement extends Statement {

  private expression?: exp.Expression

  parse(parser: Parser) {

    // TODO: If currently inside a macro expansion, capture the invoker
    //	of the macro so a better error message can be provided.

    // *** confirm no label ***

    this.expression = parser.mustParseExpression()
  }
}

//------------------------------------------------------------------------------

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
      }

      if (token.type != TokenType.DecNumber
        && token.type != TokenType.HexNumber) {
        token.setError("Hex string required")
        break
      }

      token.type = TokenType.HexNumber

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

//------------------------------------------------------------------------------

export class IncludeStatement extends Statement {

  parse(parser: Parser) {
    const token = parser.mustPushNextFileName()
    const fileName = parser.getTokenString(token)
    if (!parser.assembler.includeFile(fileName)) {
      token.setError("File not found")
    }
  }
}

//------------------------------------------------------------------------------

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

        //*** completely redo this once USR text format changed ***

        token = parser.veryNextString(")")
        if (!token.isEmpty()) {
          //*** wrap token in some kind of expression?
          scanAndPushMappedText(this.sourceLine, token, this.tokens)
        }

        token = parser.mustPushNextToken("expecting ')'")
        str = parser.getTokenString(token)
        if (str == "") {
          break
        }
        if (str != ")") {
          token.setError("Unexpected token, expecting ')'")
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

      } else if (str == ";") {
        // *** error, missing expression ***
      } else if (str == ",") {
        // *** look for X or Y ***
      } else {
        // *** consume expressions until "" or ";" ***
        let expression = parser.mustParseExpression(token)
      }
    }

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

//------------------------------------------------------------------------------

export class SaveStatement extends Statement {

  private fileName?: string

  parse(parser: Parser) {
    const token = parser.mustPushNextFileName()
    this.fileName = parser.getTokenString(token)
  }
}

//------------------------------------------------------------------------------

export class StorageStatement extends Statement {

  private sizeArg: exp.Expression | undefined
  private patternArg: exp.Expression | undefined

  parse(parser: Parser) {

    let token = parser.mustPushNextToken("expecting storage size expression")
    if (token.isEmpty()) {
      return
    }

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

//------------------------------------------------------------------------------

// *** TODO: share this with macro parser ***
// *** TODO: think about a way to make this an isolated extension of syntax

// (TEXT)	  T,E,X,T,$8D
// (TEXT)+	T,E,X,T,$8D,$FF
// (TEXT)-	T,E,X,T
// (TEXT)=	T,E,X,T^$80

// NOTE: this specifically implements the Naja mapped text user extension
export class UsrStatement extends Statement {

  private expression?: exp.Expression

  parse(parser: Parser) {

    let token = parser.mustPushNextToken("expecting '('")
    let str = parser.getTokenString(token)

    if (str == "]") {
      this.expression = parser.parseVarExpression(token)
      return
    } else if (str == "(") {
      // *** mapped text expression
    } else {
      token.setError("Unexpected token, expecting '('")
      return
    }

    token = parser.veryNextString(")")
    if (!token.isEmpty()) {
      scanAndPushMappedText(this.sourceLine, token, this.tokens)
    }

    token = parser.mustPushNextToken("expecting ')'")
    if (token.isEmpty()) {
      return
    }

    str = this.getTokenString(token)
    if (str != ")") {
      token.setError("Unexpected token, expecting ')'")
    }

    token = parser.pushNextToken()
    str = parser.getTokenString(token)
    if (str != "" && str != "+" && str != "=" && str != "-") {
      token.setError("Unexpected token, expecting '-', '=', '+', or nothing")
    }
  }
}

const mappedText = "0123456789_ABCDEFGHIJKLMNOPQRSTUVWXYZ!\"%\'*+,-./:<=>?"

// Split a string token into multiple tokens if any characters
//  are not part of mapped set.
//
// TODO: maybe hilite escaped characters differently?

function scanAndPushMappedText(sourceLine: string, token: Token, tokens: Token[]) {
  let start = token.start
  let pos = token.start
  let nextChar = ""
  let escape = false
  while (true) {
    let index = -1
    if (pos < token.end) {
      nextChar = sourceLine[pos]
      if (nextChar == "\\") {
        escape = true
        index = 0
      } else if (escape) {
        escape = false
        // TODO: support other escapes later
        if (nextChar == "n") {
          index = 0
        }
      } else {
        index = mappedText.indexOf(nextChar)
      }
    }
    if (index == -1) {
      // flush previous valid characters
      if (start < pos) {
        const t = new Token(start, pos, TokenType.String)
        tokens.push(t)
        start = pos
      }
      if (pos < token.end) {
        // push invalid character token
        const t = new Token(pos, pos + 1, TokenType.String)
        // TODO: space check not needed after USR text format update
        if (nextChar == " ") {
          t.setError("Unexpected whitespace, expecting '_'")
        } else {
          t.setError("Unexpected token, expecting valid mapped text characters")
        }
        tokens.push(t)
        start = ++pos
      }
      if (pos == token.end) {
        break
      }
    } else {
      pos += 1
    }
  }
}

//------------------------------------------------------------------------------
