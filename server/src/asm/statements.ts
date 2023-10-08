
import * as exp from "./expressions"
import { Parser } from "./parser"
import { SymbolFrom, SymbolType } from "./symbols"
import { Syntax } from "./syntax"
import { Node, Token, TokenType } from "./tokenizer"

//------------------------------------------------------------------------------

export class Statement extends exp.Expression {

  public sourceLine: string = ""

  public labelExp?: exp.SymbolExpression
  public opToken?: Token

  init(sourceLine: string, opToken: Token | undefined,
      children: Node[], labelExp?: exp.SymbolExpression) {
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

// MERLIN:
//   DASM:  <label> SUBROUTINE    (label is optional)
//   ACME:  <label> !zone {       (label required?)
//   CA65:
//   LISA:
//  SBASM:

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

  // *** split this out into a separate callable/shareable function? ***

  parse(parser: Parser) {
    let token: Token | undefined

    if (this.opcode.NONE === undefined) {
      token = parser.mustGetNextToken("expecting opcode expression")
    } else {
      token = parser.getNextToken()
    }

    let str = token?.getString().toLowerCase() ?? ""
    if (str == "") {
      if (this.opcode.NONE === undefined) {
        this.opToken?.setError("Mode not allowed for this opcode")
      }
      this.mode = OpMode.NONE
    } else if (token) {
      if (str == "a") {
        parser.addToken(token)
        if (this.opcode.A === undefined) {
          token.setError("Accumulator mode not allowed for this opcode")
        } else if (parser.syntax && parser.syntax == Syntax.ACME) {
          token.setError("Accumulator mode not allowed for ACME syntax")
        }
        token.type = TokenType.Opcode
        this.mode = OpMode.A
      } else if (str == "#") {
        parser.addToken(token)
        if (this.opcode.IMM === undefined) {
          token.setError("Immediate mode not allowed for this opcode")
        }
        token.type = TokenType.Opcode
        this.mode = OpMode.IMM
        parser.mustAddNextExpression()
      } else if (str == "/") {			// same as "#>"
        parser.addToken(token)
        if (this.opcode.IMM === undefined) {
          token.setError("Immediate mode not allowed for this opcode")
        } else if (parser.syntax && parser.syntax != Syntax.LISA) {
          // *** don't bother with this message ***
          token.setError("Syntax specific to LISA assembler")
          // TODO: would be clearer to extend warning to entire expression
        }
        this.mode = OpMode.IMM
        parser.mustAddNextExpression()
      } else if (str == "(") {
        parser.addToken(token)
        // *** check opcode has this address mode ***
        token.type = TokenType.Opcode
        parser.mustAddNextExpression()

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

          let nextToken = parser.addNextToken()
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
              token = parser.mustAddNextToken("expecting 'Y'")
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
              parser.addExpression(parser.parseLisaLocal(token, isDefinition))
              return
            }
          } else if ((str[0] == "-" || str[0] == "+")
              && (str[0] == str[str.length - 1])) {
            if (!parser.syntax || parser.syntax == Syntax.ACME) {
              if (str.length > 9) {
                token.setError("Anonymous local is too long")
                parser.addExpression(new exp.BadExpression([token]))
                return
              }
              token.type = TokenType.LocalLabelPrefix
              parser.addExpression(parser.newSymbolExpression([token], SymbolType.AnonLocal, isDefinition))
              return
            }
          }
        }

        parser.mustAddNextExpression(token)
        token = parser.addNextToken()
        // *** premature to assign ZP when expression size isn't known ***
        if (!token) {
          this.mode = OpMode.ZP             // exp
        } else {
          if (token.getString() == ",") {   // exp,X or exp,Y
            token.type = TokenType.Opcode
            token = parser.mustAddNextToken("expecting 'X' or 'Y'")
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

// TODO: should this move somewhere else?

type ConditionalState = {
  enableCount: number,
  satisfied: boolean,
  statement?: ConditionalStatement
}

export class Conditional {
  private enableCount = 1
  private satisfied = true
  public statement?: ConditionalStatement
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

  public isComplete(): boolean {
    return this.stack.length == 0
  }
}

//------------------------------------------------------------------------------

export abstract class ConditionalStatement extends Statement {

  // link between conditional statements, used to build code folding ranges
  public nextConditional?: ConditionalStatement

  abstract applyConditional(conditional: Conditional): void

  parseTrailingOpenBrace(parser: Parser): boolean {
    const opStr = this.opToken?.getString() ?? ""
    if (opStr.startsWith("!")) {
      const res = parser.mustAddToken("{")
      if (res.index == 0) {
        // TODO: start new ACME group state
        return true
      }
    }
    return false
  }
}


// MERLIN:  DO <exp>
//   DASM:  IF <exp>
//   ACME:  !if <exp> {
//   CA65:  .if <exp>
//   LISA:  .IF <exp>
//          NOTE: LISA does not support nested IF's.
//  SBASM:  .DO <exp>

export class IfStatement extends ConditionalStatement {

  private expression?: exp.Expression
  private isInline = false

  parse(parser: Parser) {
    // TODO: give hint that this expression is for conditional code
    this.expression = parser.mustAddNextExpression()
    if (this.parseTrailingOpenBrace(parser)) {

      // TODO: parse inline code after opening brace to
      //  closing brace and maybe else statement
      // TODO: fix this hack to eat ACME inline code
      let token = parser.getNextToken()
      if (token) {
        this.isInline = true

        parser.startExpression()
        while (true) {
          if (token.getString() == "}") {
            break
          }
          token.setError("Unexpected token")
          parser.addToken(token)
          token = parser.getNextToken()
          if (!token) {
            break
          }
        }
        parser.addExpression(new exp.BadExpression(parser.endExpression()))
        if (token) {
          parser.addToken(token)
        }
      }
    }
  }

  applyConditional(conditional: Conditional): void {

    // TODO: fix this hack for ACME inline code
    if (this.isInline) {
      return
    }

    if (!conditional.push()) {
      this.setError("Exceeded nested conditionals maximum")
      return
    }

    conditional.statement = this

    let value = this.expression?.resolve() ?? 0
    if (value != 0) {
      conditional.setSatisfied(true)
      conditional.enable()
    }
  }
}


// MERLIN:
//   DASM:  IFCONST <symbol>
//          IFNCONST <symbol>
//   ACME:  !ifdef <symbol> {
//          !ifndef <symbol> {
//   CA65:
//   LISA:
//  SBASM:

export class IfDefStatement extends ConditionalStatement {

  private isDefined: boolean
  private symExpression?: exp.SymbolExpression

  constructor(isDefined: boolean) {
    super()
    this.isDefined = isDefined
  }

  parse(parser: Parser) {
    const expression = parser.mustAddNextExpression()
    if (expression instanceof exp.SymbolExpression) {
      this.symExpression = expression
    } else {
      expression.setError("Symbol expression required")
    }

    this.parseTrailingOpenBrace(parser)
  }

  applyConditional(conditional: Conditional): void {
    if (!conditional.push()) {
      this.setError("Exceeded nested conditionals maximum")
      return
    }

    conditional.statement = this

    const symDefined = this.symExpression?.symbol !== undefined
    if ((symDefined && this.isDefined) || (!symDefined && !this.isDefined)) {
      conditional.setSatisfied(true)
      conditional.enable()
    }
  }
}


// MERLIN:  ELSE
//   DASM:  ELSE
//   ACME:  } else {
//   CA65:  .else
//   LISA:  .EL
//  SBASM:  .EL

export class ElseStatement extends ConditionalStatement {

  parse(parser: Parser) {
    const opStr = this.opToken?.getString() ?? ""
    if (opStr == "}") {
      const elseToken = parser.addNextToken()
      if (!elseToken) {
        parser.addMissingToken("expecting ELSE")
        return
      }
      if (elseToken.getString().toLowerCase() != "else") {
        elseToken.setError("Unexpected token, expecting ELSE")
        return
      }
      const res = parser.mustAddToken("{")
      if (res.index == 0) {
        // TODO: start new ACME group state
      }
    }
  }

  applyConditional(conditional: Conditional): void {
    if (conditional.isComplete()) {
      this.setError("Unexpected ELSE without IF")
      return
    }

    if (conditional.statement) {
      conditional.statement.nextConditional = this
    } else {
      this.setError("No matching IF statement")
      return
    }
    conditional.statement = this

    if (!conditional.isSatisfied()) {
      conditional.setSatisfied(true)
      conditional.enable()
    } else {
      conditional.disable()
    }
  }
}


// MERLIN:
//   DASM:
//   ACME:
//   CA65:  .elseif <exp>
//   LISA:
//  SBASM:

export class ElseIfStatement extends ConditionalStatement {

  private expression?: exp.Expression

  parse(parser: Parser) {
    // TODO: give hint that this expression is for conditional code
    this.expression = parser.mustAddNextExpression()
  }

  applyConditional(conditional: Conditional): void {
    if (conditional.isComplete()) {
      this.setError("Unexpected ELIF without IF")
      return
    }

    if (conditional.statement) {
      conditional.statement.nextConditional = this
    } else {
      this.setError("no matching IF/ELIF statement")
      return
    }
    conditional.statement = this

    let value = this.expression?.resolve() ?? 0
    if (conditional.isSatisfied() && value != 0) {
      conditional.setSatisfied(true)
      conditional.enable()
    } else {
      conditional.disable()
    }
  }
}


// MERLIN:  FIN
//   DASM:  ENDIF
//          EIF
//   ACME:  }
//   CA65:  .endif
//   LISA:  .FI
//  SBASM:  .FI

export class EndIfStatement extends ConditionalStatement {

  parse(parser: Parser) {
    // *** trailing close brace ***
  }

  applyConditional(conditional: Conditional): void {
    if (conditional.statement) {
      conditional.statement.nextConditional = this
    } else {
      this.setError("no matching IF/ELIF statement")
      return
    }
    if (!conditional.pull()) {
      // Merlin ignores unused FIN
      // if (!assembler->SetMerlinWarning("Unexpected FIN/ENDIF")) {
      //   return
      // }
    }
  }
}

//==============================================================================
// Storage
//==============================================================================

// *** others ***

//   LISA:  .DA <exp>[,<exp>]
//          #<expression>
//          /<expreseion>
//          <expression>
//          "string"
//          'string'

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
          parser.addToken(token)
          token = undefined
        }
      }

      // *** token could be "," here ***

      let expression = parser.addNextExpression(token)
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
      parser.addToken(token)
      return
    }

    if (token.getString() == "\\") {
      if (!parser.syntax || parser.syntax == Syntax.MERLIN) {
        this.sizeArg = new exp.AlignExpression(new exp.NumberExpression([token], 256, false))
        parser.addExpression(this.sizeArg)
      } else {
        parser.addToken(token)
        token.setError("Invalid storage size")
        return
      }
    } else {
      this.sizeArg = parser.mustAddNextExpression(token)
      if (!this.sizeArg) {
        return
      }

      //*** error if resolved value is out of range
    }

    if (parser.mustAddToken(["", ","]).index <= 0) {
      return
    }

    this.patternArg = parser.mustAddNextExpression()
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
      let token = parser.addNextToken()
      if (!token) {
        parser.addMissingToken("Hex value expected")
        break
      }

      let hexString = token.getString().toUpperCase()
      // *** TODO: which syntaxes is the true for? ***
      if (hexString == "$") {
        token.setError("$ prefix not allowed on HEX statements")
        token = parser.addNextToken()
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

      token = parser.addNextToken()
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

// DASM: symbol EQU exp
//       symbol = exp

export class EquStatement extends Statement {

  private value?: exp.Expression

  parse(parser: Parser) {
    if (!this.labelExp) {
      this.opToken?.setError("Missing label")
      return
    }

    this.value = parser.mustAddNextExpression()
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

    this.value = parser.mustAddNextExpression()
  }
}

//------------------------------------------------------------------------------

export class OrgStatement extends Statement {

  private value?: exp.Expression

  parse(parser: Parser) {
    if (this.opToken?.getString() == "*") {
      const res = parser.mustAddToken("=")
      if (res.index < 0) {
        return
      }
    }

    this.value = parser.mustAddNextExpression()
  }
}


export class EntryStatement extends Statement {
  parse(parser: Parser) {
    if (this.labelExp) {
      this.labelExp.isEntryPoint = true
    } else {
      this.opToken?.setError("Label is required")
    }
  }
}


export class ErrorStatement extends Statement {

  private errExpression?: exp.Expression

  parse(parser: Parser) {
    // *** maybe use a different variation like parseControlExpression?
    this.errExpression = parser.parseExpression()
    if (this.errExpression) {
      parser.addExpression(this.errExpression)
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
        parser.addToken(token)
        continue
      }

      if (str == "(") {
        const strExpression = parser.parseStringExpression(token, true, false)
        parser.addExpression(strExpression)
        continue

        // *** attempt NajaText
        // *** attempt 6502 addressing
      }

      const expression = parser.addNextExpression(token)
      if (!expression) {
        break
      }
    }
  }
}

//==============================================================================
// Macros
//==============================================================================

// MERLIN:  <name> MAC    (label required)
//   DASM:  MAC <name>    (no label allowed)
//          MACRO <name>
//   ACME:  <name> !macro {
//   CA65:  .mac <name>
//          .macro <name>
//   LISA:
//  SBASM:  <name> .MA <params-list>

export class MacroDefStatement extends Statement {
}


// MERLIN:  EOM       (label is allowed)
//          <<<
//   DASM:  ENDM      (no label allowed)
//   ACME:  }
//   CA65:  .endmac
//          .endmacro
//   LISA:
//  SBASM:  <name> .EM

export class EndMacroDefStatement extends Statement {
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
        parser.addToken(token)
        continue
      }

      if (str == "(") {
        // *** must at least one ";" before doing this??? ***
        const strExpression = parser.parseStringExpression(token, true, false)
        parser.addExpression(strExpression)
        continue

        // *** attempt NajaText
        // *** attempt 6502 addressing
      }

      const expression = parser.addNextExpression(token)
      if (!expression) {
        break
      }

      // *** what about "," ?
    }
  }

  // ***
}

//------------------------------------------------------------------------------
