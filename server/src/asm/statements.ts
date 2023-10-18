
import * as exp from "./expressions"
import { Parser } from "./parser"
import { Preprocessor, Conditional, SymbolUtils } from "./preprocessor"
import { SymbolFrom, SymbolType } from "./symbols"
import { Syntax, Op } from "./syntax"
import { Node, Token, TokenType } from "./tokenizer"

//------------------------------------------------------------------------------

export abstract class Statement extends exp.Expression {

  public sourceLine: string = ""
  public labelExp?: exp.SymbolExpression
  public opExp?: exp.Expression
  public opNameLC = ""
  public enabled = true

  init(sourceLine: string, children: Node[],
      labelExp?: exp.SymbolExpression,
      opExp?: exp.Expression) {
    this.children = children
    this.sourceLine = sourceLine
    this.labelExp = labelExp
    this.opExp = opExp
    this.opNameLC = this.opExp?.getString().toLowerCase() ?? ""
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

  postProcessSymbols(symUtils: SymbolUtils) {
  }

  // TODO: should any statement need resolve() or getSize()?
}


export class GenericStatement extends Statement {
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
      // insert implied label
      this.labelExp = new exp.SymbolExpression([], SymbolType.Simple, true,
        parser.sourceFile, parser.lineNumber)
      this.children.unshift(this.labelExp)
    }
    if (this.labelExp.symbol) {
      this.labelExp.symbol.isZoneStart = true
    }

    // *** if !zone, look for optional trailing open brace ***
  }
}

//==============================================================================
// Opcodes
//==============================================================================

export enum OpMode {
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

  public opcode: any
  public mode: OpMode = OpMode.NONE
  private opExpression?: exp.Expression

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

    // NOTE: Guess at and set this.mode early so it's available
    //  while generating code completion options.

    let str = token?.getString().toLowerCase() ?? ""
    if (str == "") {
      if (this.opcode.NONE === undefined) {
        this.opExp?.setError("Mode not allowed for this opcode")
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
        this.opExpression = parser.mustAddNextExpression()
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
        // *** this loses the implied ">" operation
        this.opExpression = parser.mustAddNextExpression()
      } else if (str == "(") {
        parser.addToken(token)
        // *** check opcode has this address mode ***
        token.type = TokenType.Opcode
        this.mode = OpMode.IND
        this.opExpression = parser.mustAddNextExpression()

        let res = parser.mustAddToken([",", ")"], TokenType.Opcode)
        if (res.index == 0) {               // (exp,X)
          this.mode = OpMode.INDX
          res = parser.mustAddToken("x", TokenType.Opcode)
          if (res.index == 0 && res.token) {
            if (this.opcode.INDX === undefined) {
              res.token.setError("Indirect mode not allowed for this opcode")
            }
            token.type = TokenType.Opcode
            parser.mustAddToken(")", TokenType.Opcode)
          }
          return

        } else if (res.index == 1) {        // (exp) or (exp),Y
          this.mode = OpMode.INDY
          let nextToken = parser.addNextToken()
          if (!nextToken) {
            this.mode = OpMode.IND
            if (this.opcode.IND === undefined) {
              token.setError("Indirect mode not allowed for this opcode")
            }
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

        if (this.opcode.BRAN || (this.opcode.ABS &&
            (this.opNameLC == "jmp" || this.opNameLC == "jsr"))) {

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
              token.type = TokenType.Label
              parser.addExpression(parser.newSymbolExpression([token], SymbolType.AnonLocal, isDefinition))
              return
            }
          }
        }

        this.opExpression = parser.mustAddNextExpression(token)

        token = parser.addNextToken()
        if (!token) {
          this.mode = OpMode.ABS            // exp
        } else {
          if (token.getString() == ",") {   // exp,X or exp,Y
            token.type = TokenType.Opcode
            token = parser.mustAddNextToken("expecting 'X' or 'Y'")
            if (token.type != TokenType.Missing) {
              str = token.getString().toLowerCase()
              if (str == "x") {             // exp,X
                this.mode = OpMode.ABSX
                token.type = TokenType.Opcode
              } else if (str == "y") {      // exp,Y
                this.mode = OpMode.ABSY
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
  }

  // called after symbols have been processed
  //  TODO: make this part of assemble phases
  postProcessSymbols(symUtils: SymbolUtils) {
    if (this.opExpression) {
      switch (this.mode) {
        case OpMode.NONE:
        case OpMode.A:
          // mode already checked
          break
        case OpMode.IMM:
          // mode already checked
          symUtils.markConstants(this.opExpression)
          break
        case OpMode.ZP:
        case OpMode.ZPX:
        case OpMode.ZPY:
          // will never be ZPAGE at this point
          break
        case OpMode.ABS:
          if (this.opcode.BRAN) {
            this.mode = OpMode.BRANCH
            symUtils.markCode(this.opExpression)
            break
          }
          if (this.opNameLC == "jmp") {
            symUtils.markCode(this.opExpression)
            break
          }
          if (this.opNameLC == "jsr") {
            symUtils.markSubroutine(this.opExpression)
            break
          }
          // fall through
        case OpMode.ABSX:
        case OpMode.ABSY:
          const size = this.opExpression.getSize() ?? 0
          if (size == 1) {
            // TODO: when downgrading, handle case where opcode
            //  could be ABS but not ZP
            this.mode = this.mode - OpMode.ABS + OpMode.ZP
            symUtils.markZPage(this.opExpression)
          } else {
            symUtils.markData(this.opExpression)
          }
          // *** check resulting mode
          break
        case OpMode.IND:
          // mode already checked
          break
        case OpMode.INDX:
        case OpMode.INDY:
          // mode already checked
          symUtils.markZPage(this.opExpression)
          // *** mark as error if too large ***
          break
        case OpMode.BRANCH:
          // will never be BRANCH at this point
          break
      }
    }

    // if opcode has label, label must be code
    if (this.labelExp) {
      symUtils.markCode(this.labelExp)
    }
  }
}

//==============================================================================
// Conditionals
//==============================================================================

export abstract class ConditionalStatement extends Statement {

  // link between conditional statements, used to build code folding ranges
  public nextConditional?: ConditionalStatement

  abstract applyConditional(conditional: Conditional): void

  parseTrailingOpenBrace(parser: Parser): boolean {
    if (this.opNameLC.startsWith("!")) {
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

  postProcessSymbols(symUtils: SymbolUtils): void {
    if (this.expression) {
      symUtils.markConstants(this.expression)
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
    if (this.opNameLC == "}") {
      const elseToken = parser.addNextToken()
      if (!elseToken) {
        parser.addMissingToken("expecting ELSE")
        return
      }
      if (elseToken.getString().toLowerCase() != "else") {
        elseToken.setError("Unexpected token, expecting ELSE")
        return
      }
      elseToken.type = TokenType.Keyword
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

  postProcessSymbols(symUtils: SymbolUtils): void {
    if (this.expression) {
      symUtils.markConstants(this.expression)
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

// *** mark label as storage ***

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
  protected dataElements: exp.Expression[] = []

  constructor(dataSize: number, swapEndian = false) {
    super()
    this.dataSize = dataSize
    this.swapEndian = swapEndian
  }

  parse(parser: Parser) {

    const symbol = this.labelExp?.symbol
    if (symbol) {
      symbol.isData = true
    }

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

      const expression = parser.addNextExpression(token)
      if (!expression) {
        // *** what happens to token?
        break
      }

      this.dataElements.push(expression)
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

  postProcessSymbols(symUtils: SymbolUtils) {
    for (let expression of this.dataElements) {
      symUtils.markConstants(expression)
    }
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

    const symbol = this.labelExp?.symbol
    if (symbol) {
      symbol.isData = true
    }

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

    const symbol = this.labelExp?.symbol
    if (symbol) {
      symbol.isData = true
    }

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

  private fileName?: string
  private fileNameToken?: Token

  parse(parser: Parser) {
    const token = parser.mustPushNextFileName()
    const fileName = token.getString()
    if (fileName != "") {       // *** check for missing token
      this.fileName = fileName
      this.fileNameToken = token
    }
  }

  preprocess(preprocessor: Preprocessor) {
    if (this.fileName) {
      if (!preprocessor.includeFile(this.fileName)) {
        this.fileNameToken?.setError("File not found")
      }
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
      parser.insertMissingLabel()
      return
    }

    this.value = parser.mustAddNextExpression()
    this.labelExp.symbol?.setValue(this.value, SymbolFrom.Equate)
  }
}

export class VarStatement extends Statement {

  private value?: exp.Expression

  parse(parser: Parser) {

    if (this.opNameLC != "=") {
      this.opExp?.setError("Expecting '='")
      return
    }

    this.value = parser.mustAddNextExpression()
  }
}

//------------------------------------------------------------------------------

export class OrgStatement extends Statement {

  private value?: exp.Expression

  parse(parser: Parser) {
    if (this.opNameLC == "*") {
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
      if (this.labelExp.symbol) {
        this.labelExp.symbol.isEntryPoint = true
      }
    } else {
      parser.insertMissingLabel()
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

// MERLIN:  <name> MAC           (label required)
//   DASM:         MAC <name>    (no label allowed)
//                 MACRO <name>
//   ACME:  !macro <name> [<params-list>] {
//   CA65:         .mac <name>
//                 .macro <name>
//   LISA:
//  SBASM:  <name> .MA [<params-list>]

export class MacroDefStatement extends Statement {

  public macroName?: exp.SymbolExpression

  parse(parser: Parser) {

    if (this.labelExp) {
      if (parser.syntax == Syntax.DASM
          || parser.syntax == Syntax.ACME
          || parser.syntax == Syntax.CA65) {
        this.labelExp.setError("Label not allowed")
      } else if (this.labelExp.isLocalType()) {
        this.labelExp.setError("Local label not allowed")
      } else {
        this.macroName = this.labelExp
        this.macroName.symbolType = SymbolType.Macro
        if (this.macroName.symbol) {
          this.macroName.symbol.type = SymbolType.Macro
        }
      }
    } else if (parser.syntax == Syntax.MERLIN) {
      /*|| parser.syntax == Syntax.SBASM*/
      parser.insertMissingLabel()
    }

    // TODO: rewrite/split this logic to be clearer
    if (parser.syntax != Syntax.MERLIN) {
      let token = parser.getNextToken()
      if (token) {
        // macro name
        if (token.type == TokenType.Symbol
            || token.type == TokenType.HexNumber) {
          const isDefinition = true
          this.macroName = new exp.SymbolExpression([token], SymbolType.Macro,
            isDefinition, parser.sourceFile, parser.lineNumber)
          parser.addExpression(this.macroName)
          token = parser.getNextToken()
        }
        if (token) {
          if (token.getString() == "{") {
            if (!this.macroName) {
              token.setError("Unexpected token, expected macro name")
            } else if (parser.syntax && parser.syntax != Syntax.ACME) {
              token.setError("Unexpected token")
            }
            parser.addToken(token)
          } else {
            // TODO: parse params
          }
        } else if (parser.syntax == Syntax.ACME) {
          parser.addMissingToken("opening brace expected")
        }
      } else {
        if (parser.syntax == Syntax.DASM
            || parser.syntax == Syntax.ACME
            || parser.syntax == Syntax.CA65) {
          parser.addMissingToken("macro name expected")
        }
      }
    }
  }
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

  parse(parser: Parser) {
    // *** enforce label or not ***
  }
}

//------------------------------------------------------------------------------

// TODO: probably needs to be split by syntax

export class MacroInvokeStatement extends Statement {

  public macroName?: exp.SymbolExpression

  parse(parser: Parser) {

    if (this.opNameLC.startsWith("+")) {
      // *** maybe make parser.parseOpcode smarter instead? ***
      if (!parser.syntax || parser.syntax == Syntax.ACME) {
        // *** split into two tokens and replace in this.children
        // *** this.opToken becomes second new token
      } else {
        // *** force error ***
      }
    }

    // *** create symExpression from opToken
    // *** replace opToken in this.children

    while (true) {
      let token = parser.getNextToken()
      if (!token) {
        break
      }

      const str = token.getString()

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
