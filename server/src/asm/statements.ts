
import * as exp from "./expressions"
import { Assembler, NestingType, TypeDef, LoopVar, Conditional, Segment } from "./assembler"
import { Parser } from "./parser"
import { SymbolUtils } from "./assembler"
import { SymbolType, SymbolFrom } from "./symbols"
import { Syntax, Op } from "./syntaxes/syntax_types"
import { Node, Token, TokenType } from "./tokenizer"
import { KeywordDef } from "./syntaxes/syntax_types"

import { OpcodeType, OpMode } from "../isa65xx"

//==============================================================================
//#region Statement
//==============================================================================

export abstract class Statement extends exp.Expression {

  public sourceLine: string = ""
  public startOffset?: number
  public endOffset?: number
  public labelExp?: exp.SymbolExpression
  public opExp?: exp.Expression
  public args: exp.Expression[] = []
  public opNameLC = ""
  public keywordDef?: KeywordDef
  public enabled = true             // false for inactive conditional clauses
  public PC?: number                // set before preprocess call
  public repeated?: boolean         // true if already used within loop

  // segment this statement will be written to
  public segment?: Segment

  // TODO: add optional character mapping table for text in this statement

  // link between conditional statement groups, used to build code folding ranges
  public foldEnd?: Statement

  init(sourceLine: string, children: Node[],
      labelExp?: exp.SymbolExpression,
      opExp?: exp.Expression,
      keywordDef?: KeywordDef) {
    this.children = children
    this.sourceLine = sourceLine
    this.labelExp = labelExp
    this.opExp = opExp
    this.keywordDef = keywordDef
    // TODO: consider trimming off/separating prefix operator ("+", "!", ".")
    this.opNameLC = this.opExp?.getString().toLowerCase() ?? ""
  }

  public findArg(name: string): exp.Expression | undefined {
    for (let arg of this.args) {
      if (arg.name == name) {
        return arg
      }
    }
  }

  public findArgs(name: string): exp.Expression[] {
    const args = []
    for (let arg of this.args) {
      if (arg.name == name) {
        args.push(arg)
      }
    }
    return args
  }

  public hasTrailingOpenBrace(): boolean {
    // TODO: make this ACME-only?
    if (this.children.length) {
      return this.children[this.children.length - 1].getString() == "{"
    } else {
      return false
    }
  }

  // parse the statement line but don't change any external state
  parse(parser: Parser) {

    if (this.keywordDef?.paramsList) {

      if (this.keywordDef.label !== undefined) {
        if (this.keywordDef.label == "") {
          if (this.labelExp) {
            this.labelExp.setError("Label not allowed here")
          }
        } else if (this.keywordDef.label[0] == "<") {
          if (!this.labelExp) {
            parser.insertMissingLabel()
          }
        }
      }

      parser.paramsParser.parseExpressions(this.keywordDef.paramsList, parser)

      this.args = []
      for (let node of this.children) {
        if (node == this.labelExp || node == this.opExp) {
          continue
        }
        if (node instanceof exp.Expression) {
          this.args.push(node)
        }
      }
    }

    // TODO: does this default implementation still make sense?
    // TODO: just eat expressions? do nothing instead?
    // let token = parser.getNextToken()
    // while (token) {
    //   const expression = parser.parseExpression(token)
    //   if (!expression) {
    //     break
    //   }
    //   this.children.push(expression)

    //   const res = parser.mustAddToken(["", ","])
    //   if (res.index <= 0) {
    //     break
    //   }
    //   token = parser.getNextToken()
    // }
  }

  postParse(parser: Parser) {
  }

  // TODO: rename this pass0 ?
  public preprocess(asm: Assembler) {
    // TODO: share with applyConditional?
    this.forEachExpression((expression) => {
      if (expression instanceof exp.SymbolExpression) {
        asm.processSymbol_pass0(expression)
      } else if (expression instanceof exp.PcExpression) {
        if (this.PC !== undefined) {
          expression.setValue(this.PC)
        } else if (!expression.hasError()) {
          expression.setError("PC not resolvable")
        }
      }
    })
  }

  postProcessSymbols(symUtils: SymbolUtils) {
  }

  // TODO: should any statement need resolve() or getSize()?

  // return number of bytes to advance PC
  //  (could be different from number of bytes generated,
  //  in the case of structure definitions, for example)
  // only called if enabled
  public pass1(asm: Assembler): number {
    return 0
  }

  // only called if enabled
  public pass2(asm: Assembler) {
    // calls back to asm.writeBytes, etc. to generate bytes
  }

  findExpressionAt(ch: number): { expression: exp.Expression, token: Token } | undefined {
    return super.findExpressionAt(ch + (this.startOffset ?? 0))
  }
}


export class GenericStatement extends Statement {
}


export class ContinuedStatement extends Statement {

  public firstStatement: Statement

  constructor(firstStatement: Statement, start: number, end: number) {
    super()
    this.firstStatement = firstStatement
    this.startOffset = start
    this.endOffset = end
    this.children = firstStatement.children
  }

  public override preprocess(asm: Assembler) {
    // don't do any symbol processing here
  }
}

// TODO: add this to support multiple statements on a single line
// export class CompoundStatement extends Statement {
// }

//#endregion
//==============================================================================
//#region Opcodes
//==============================================================================

export class OpStatement extends Statement {

  public opcode: OpcodeType
  public opSuffix: string
  // public cpu: OpCpu
  private forceLong: boolean
  public mode: OpMode = OpMode.NONE
  private expression?: exp.Expression

  constructor(opcode: OpcodeType, opSuffix: string/*, cpu: OpCpu*/, forceLong: boolean) {
    super()
    this.opcode = opcode
    this.opSuffix = opSuffix
    // this.cpu = cpu
    this.forceLong = forceLong
  }

  // TODO: parse more addressing modes (65C02, 65816, 65EL02)
  parse(parser: Parser) {
    let token: Token | undefined

    if (this.opcode.get(OpMode.NONE) === undefined) {
      token = parser.mustGetNextToken("expecting opcode expression")
    } else {
      token = parser.getNextToken()
    }

    if (!parser.syntax || parser.syntax == Syntax.DASM) {
      // TODO: use this.opSuffix to help choose mode
    }

    // NOTE: Guess at and set this.mode early so it's available
    //  while generating code completion options.

    let str = token?.getString().toLowerCase() ?? ""
    if (str == "") {

      // TODO: check for INC/DEC and promote opcode to 65C02

      this.mode = OpMode.NONE
      if (this.opcode.get(OpMode.NONE) === undefined) {
        if (this.opcode.get(OpMode.A)) {
          this.mode = OpMode.A
        }
      }
      return
    }

    if (token) {

      // special case 65816 mvp/mvn SD mode "#$FF,#$FF"

      if (this.opcode.get(OpMode.SD)) {
        this.mode = OpMode.SD

        // TODO: fold this into expression parsing
        if (str == "#") {
          parser.addToken(token)
          token.type = TokenType.Opcode
          token = undefined
        }

        parser.mustAddNextExpression(token)

        let res = parser.mustAddToken([","], TokenType.Opcode)
        if (res.index == 0) {
          token = parser.getNextToken()

          // TODO: fold this into expression parsing
          if (token?.getString() == "#") {
            parser.addToken(token)
            token.type = TokenType.Opcode
            token = undefined
          }
          // TODO: save this expression for code gen use
          parser.mustAddNextExpression(token)
        }
        return
      }
      if (str == "a") {

        // not accumulator mode if CA65 "a:" prefix
        if (parser.syntax != Syntax.CA65 || parser.peekVeryNextChar() != ":") {

          parser.addToken(token)

          // TODO: check for INC/DEC and promote opcode to 65C02

          if (this.opcode.get(OpMode.A) === undefined) {
            token.setError("Accumulator mode not allowed for this opcode")
          } else if (parser.syntax == Syntax.ACME || parser.syntax == Syntax.DASM) {
            token.setError("Accumulator mode not allowed for this syntax")
          }
          token.type = TokenType.Opcode
          this.mode = OpMode.A
          return
        }
      }
      if (str == "#") {

        parser.addToken(token)
        token.type = TokenType.Opcode
        this.mode = OpMode.IMM
        this.expression = parser.mustAddNextExpression()
        return
      }
      if (str == "/") {			// same as "#>"

        parser.addToken(token)
        if (parser.syntax && parser.syntax != Syntax.LISA) {
          // TODO: also supported by ORCA/M
          // TODO: don't bother with this message
          token.setError("Syntax specific to LISA assembler")
          // TODO: would be clearer to extend warning to entire expression
        }
        this.mode = OpMode.IMM
        // *** this loses the implied ">" operation
        this.expression = parser.mustAddNextExpression()
        return
      }
      if (str == "(" || str == "[") {

        token.type = TokenType.Opcode
        parser.addToken(token)

        // handle "(#<label+1)" supported by DASM
        // TODO: limit by syntax?
        if (str == "(") {
          const nextToken = parser.peekNextToken()
          if (nextToken) {
            if (nextToken.getString() == "#") {
              nextToken.type = TokenType.Opcode
              parser.commitAddToken(nextToken)
              this.mode = OpMode.IMM
              this.expression = parser.mustAddNextExpression()
              parser.mustAddToken([")"], TokenType.Opcode)
              return
            }
          }
        }

        // TODO: split address mode parsing into a separate function

        // default to indirect for any mode starting with ( or [
        this.mode = OpMode.IND

        const closingChar = str == "(" ? ")" : "]"

        this.expression = parser.mustAddNextExpression()

        let res = parser.mustAddToken([",", closingChar], TokenType.Opcode)
        if (res.index == 0) {

          // ($FF,X) or ($FFFF,X) or ($FF,S),Y or ($FF,R),Y
          // [$FF,X] or [$FFFF,X] or [$FF,S],Y or [$FF,R],Y

          const c = parser.peekVeryNextChar()
          res = parser.mustAddToken(["x", "s", "r"], TokenType.Opcode)
          if (res.index < 0) {
            return
          }

          if (res.index == 0) {

            // ($FF,X) or ($FFFF,X)
            // [$FF,X] or [$FFFF,X]  (not valid)

            if (closingChar == ")") {
              this.mode = OpMode.INDX
            } else {
              this.opExp?.setErrorWeak("Opcode does not support this addressing mode")
            }

            if (parser.syntax == Syntax.DASM) {
              if (c == " " || c == "\t") {
                res.token!.setError("DASM doesn't allow space between ',' and X register")
              }
            }
            parser.mustAddToken(closingChar, TokenType.Opcode)

          } else if (res.index > 0) {

            // ($FF,S),Y or ($FF,R),Y
            // [$FF,S],Y or [$FF,R],Y  (not valid)

            parser.mustAddToken(closingChar, TokenType.Opcode)
            res = parser.mustAddToken(",", TokenType.Opcode)
            if (res.index == 0) {
              res = parser.mustAddToken("y", TokenType.Opcode)
              if (res.index == 0) {
                if (closingChar == ")") {
                  this.mode = res.index == 0 ? OpMode.SIY : OpMode.RIY
                } else {
                  this.opExp?.setErrorWeak("Opcode does not support this addressing mode")
                }
              }
            }
          }
          return

        } else {

          let nextToken = parser.addNextToken()
          if (!nextToken) {

            // ($FF) or ($FFFF)
            // [$FF] or [$FFFF]
            if (closingChar == ")") {
              this.mode = OpMode.IND
            } else {
              this.mode = OpMode.ALI
            }

          } else {

            // ($FF),Y
            // [$FF],Y
            if (closingChar == ")") {
              this.mode = OpMode.INDY
            } else {
              this.mode = OpMode.LIY
            }

            token = nextToken
            str = token.getString()
            if (str == ",") {
              token.type = TokenType.Opcode
              const c = parser.peekVeryNextChar()
              res = parser.mustAddToken("y", TokenType.Opcode)
              if (res.index == 0) {
                if (parser.syntax == Syntax.DASM) {
                  if (c == " " || c == "\t") {
                    res.token!.setError("DASM doesn't allow space between ',' and Y register")
                  }
                }
              }
              // TODO: maybe undo token adds
            } else {
              // TODO: maybe undo token add
              token.setError("Unexpected token")
            }
          }
        }
        return
      }


      const isDefinition = false
      if (str == ">" || str == "<") {
        if (!parser.syntax || parser.syntax == Syntax.LISA) {
          this.expression = parser.parseLisaLocal(token, isDefinition)
          parser.addExpression(this.expression)
        }
      } else if (str[0] == ":" && parser.syntax == Syntax.CA65) {
        this.expression = parser.parseCA65Local(token, isDefinition)
        parser.addExpression(this.expression)
      } else if (parser.syntaxDef.anonLocalChars && parser.syntaxDef.anonLocalChars.includes(str[0])) {
        if (str[0] == str[str.length - 1]) {
          // TODO: This only handles "-", not "+" because it would otherwise
          //  be parsed as a unary operator.  See Parser.parseValueExpression
          //  for the code that should be handling this.
          if (str.length > 9) {
            token.setError("Anonymous local is too long")
            this.expression = new exp.BadExpression([token])
            parser.addExpression(this.expression)
          } else {
            token.type = TokenType.Label
            this.expression = parser.newSymbolExpression([token], SymbolType.AnonLocal, isDefinition)
            parser.addExpression(this.expression)
          }
        }
      }

      if (!this.expression) {
        this.expression = parser.mustAddNextExpression(token)
      }

      token = parser.addNextToken()

      // TODO: hack to stop parsing an ACME multi-statement line
      if (token) {
        if (parser.syntax == Syntax.ACME) {
          if (token.getString() == ":") {
            parser.ungetToken(token)
            parser.nodeSet.pop()
            token = undefined
          }
        }
      }

      if (!token) {
        if (this.opcode.get(OpMode.REL)) {
          this.mode = OpMode.REL            // exp
        } else if (this.opcode.get(OpMode.LREL)) {
          this.mode = OpMode.LREL           // exp
        } else if (this.opcode.get(OpMode.ABS)) {
          this.mode = OpMode.ABS            // exp
        } else if (this.opcode.get(OpMode.LABS)) {
          this.mode = OpMode.LABS           // exp
        } else if (this.opcode.get(OpMode.ZP)) {
          this.mode = OpMode.ZP             // PEI exp
        } else if (this.opNameLC == "brk") {
          this.mode = OpMode.IMM            // exp
        }
      } else if (token.getString() == ",") {

        // exp,X or exp,Y or exp,S or exp,R

        token.type = TokenType.Opcode
        const c = parser.peekVeryNextChar()
        token = parser.mustAddNextToken("expecting 'X', 'Y', 'S' or 'R'")
        if (token.type != TokenType.Missing) {
          str = token.getString().toLowerCase()
          if (str == "x") {             // exp,X
            this.mode = OpMode.ABSX
          } else if (str == "y") {      // exp,Y
            this.mode = OpMode.ABSY
          } else if (str == "s") {      // exp,S
            // TODO: check for 65816 mode
            this.mode = OpMode.STS
          } else if (str == "r") {      // exp,R
            // TODO: check for 65el02 mode
            this.mode = OpMode.STR
          } else if (str != "") {
            token.setError("Unexpected token, expecting 'X', 'Y', 'S' or 'R'")
            return
          }
          token.type = TokenType.Opcode
          if (parser.syntax == Syntax.DASM) {
            if (c == " " || c == "\t") {
              token.setError("DASM doesn't allow space between ',' and X or Y register")
            }
          }
        }
      } else {

        // TODO: fix hack to stop parsing an ACME multi-statement line
        if (parser.syntax == Syntax.ACME) {
          if (token.getString() == ":") {
            parser.ungetToken(token)
            parser.nodeSet.pop()
            return
          }
        }

        token.setError("Unexpected token, expecting ','")
      }
    }
  }

  pass1(asm: Assembler): number {

    // opcode promotion/demotion happens here

    let opDef = this.opcode.get(this.mode)
    const expSize = this.expression?.getSize() ?? 0
    let newMode = this.mode

    switch (this.mode) {

      case OpMode.ABS:      // $FFFF
      case OpMode.ABSX:     // $FFFF,X
      case OpMode.ABSY:     // $FFFF,Y
        if (expSize == 1 && !this.forceLong) {
          if (this.mode == OpMode.ABS) {
            newMode = OpMode.ZP   // $FF
          } else if (this.mode == OpMode.ABSX) {
            newMode = OpMode.ZPX  // $FF,X
          } else {
            newMode = OpMode.ZPY  // $FF,Y
          }
          if (!this.opcode.get(newMode)) {
            // TODO: warn that ABS mode will be used instead of ZP?
            this.opExp?.setWarning("ZP address forced to ABS")
          }
        } else if (expSize == 3) {
          if (this.mode == OpMode.ABS || !opDef) {
            newMode = OpMode.LABS   // $FFFFFF
          } else if (this.mode == OpMode.ABSX || !opDef) {
            newMode = OpMode.LABX   // $FFFFFF,X
          } else {
            break
          }
        }
        break

      case OpMode.IND:      // ($FFFF)
        if (expSize == 1 && !this.forceLong) {
          newMode = OpMode.INZ    // ($FF)
        }
        break

      case OpMode.INDX:     // ($FF,X)
        // TODO: put actual size check back in once import statements, etc.
        //  are more explicit in their symbol size definitions.
        // if (expSize == 2) {
        if (expSize != 1) {
          newMode = OpMode.AXI    // ($FFFF,X)
        }
        break

      case OpMode.ALI:      // [$FFFF]
        if (expSize == 1 && !this.forceLong) {
          newMode = OpMode.LIN    // [$FF]
        }
        break
    }

    if (newMode != this.mode) {
      const newOpDef = this.opcode.get(newMode)
      if (newOpDef) {
        opDef = newOpDef
        this.mode = newMode
      }
    }

    if (!opDef) {
      // special-case brk instruction with optional extra argument
      if (this.opNameLC == "brk") {
        if (this.mode == OpMode.IMM || this.mode == OpMode.ZP) {
          return 1
        }
      } else if (this.opNameLC == "cop") {
        // COP argument should be IMM but assemblers (CA65) often allow # to be omitted
        this.mode = OpMode.IMM
        return 1
      }
      this.opExp?.setErrorWeak("Opcode does not support this addressing mode")
    } else {
      return opDef.bc
    }

    return 0
  }

  pass2(asm: Assembler): void {

    const opDef = this.opcode.get(this.mode)
    if (opDef !== undefined) {

      // TODO: this needs to be reworked
      if (this.expression) {
        switch (this.mode) {
          // case OpMode.NONE:
          // case OpMode.A:
          case OpMode.IMM:
            if (this.expression) {
              asm.symUtils.markConstants(this.expression)
              const immValue = this.expression.resolve()
              if (immValue === undefined) {
                if (this.expression instanceof exp.StringExpression) {
                  this.expression.setError("String expression not valid here")
                }
              } else {
                if (immValue < 0) {
                  // TODO: generalize this setting and check other syntaxes
                  if (asm.syntax == Syntax.CA65) {
                    this.expression.setError(`Value ${immValue} out of range`)
                  }
                }

                // TODO: skip if 65816
                // if (immValue > 255) {
                //   this.expression.setWarning(`Immediate value ${immValue} will be truncated`)
                // }
              }
            }
            break
          case OpMode.ZP:
          case OpMode.ZPX:
          case OpMode.ZPY:
            asm.symUtils.markZPage(this.expression)
            break
          case OpMode.ABS:
            if (opDef && opDef.fc) {
              if (this.opNameLC == "jmp") {
                asm.symUtils.markCode(this.expression)
                break
              }
              if (this.opNameLC == "jsr" || this.opNameLC == "jsl") {
                asm.symUtils.markSubroutine(this.expression)
                break
              }
            }
            // fall through
          case OpMode.ABSX:
          case OpMode.ABSY:
            asm.symUtils.markData(this.expression)

            // check for zpage demotion was prevented by a forward reference
            if (!this.forceLong) {
              const expSize = this.expression!.getSize() ?? 0
              if (expSize == 1) {
                let newMode
                if (this.mode == OpMode.ABS) {
                  newMode = OpMode.ZP   // $FF
                } else if (this.mode == OpMode.ABSX) {
                  newMode = OpMode.ZPX  // $FF,X
                } else {
                  newMode = OpMode.ZPY  // $FF,Y
                }
                if (this.opcode.get(newMode)) {
                  this.expression!.setWarning("ZP variable declared after use treated as ABS")
                }
              }
            }
            break
          case OpMode.IND:
            break
          case OpMode.INDX:
          case OpMode.INDY:
            asm.symUtils.markZPage(this.expression)
            const value = this.expression.resolve()
            if (value !== undefined) {
              if (value > 255) {
                this.expression.setError("Expression too large for addressing mode")
              }
            }
            break

          case OpMode.REL:
          case OpMode.LREL:
            if (opDef && opDef.fc) {
              asm.symUtils.markCode(this.expression)
            }
            break

          // case OpMode.INZ:      // ($FF)
          // case OpMode.LIN:      // [$FF]
          // case OpMode.LIY:      // [$FF],Y
          // case OpMode.AXI:      // ($FFFF,X)
          // case OpMode.LABS:     // $FFFFFF
          // case OpMode.LABX:     // $FFFFFF,X
          // case OpMode.ALI:      // [$FFFF]
          // case OpMode.STS:      // stack,S
          // case OpMode.SIY:      // (stack,S),Y
          // case OpMode.SD:       // #$FF,#$FF
          // case OpMode.STR:      // stack,R
          // case OpMode.RIY:      // (stack,R),Y
        }
      }

      if (this.labelExp) {
        asm.symUtils.markCode(this.labelExp)
      }

      asm.writeByte(opDef.val)
      if (this.expression) {
        let value = this.expression.resolve()
        if (value !== undefined) {
          if (opDef.bc == 2) {
            if (this.mode == OpMode.REL) {
              value = value - this.PC! - 2
              if (value < -128 || value > 127) {
                this.expression.setError(`Branch delta ${value} out of range}`)
                return
              }
            } else {
              if (asm.syntax == Syntax.CA65) {
                // TODO: add this once structure offsets are implemented
                // if (value < 0 || value > 255) {
                //   this.expression.setError(`Expression value ${value} out of range 0..255`)
                //   return
                // }
              } else if (value < -128 || value > 255) {
                // TODO: skip this if 65816
                // this.expression.setWarning(`Value ${value} will be truncated to 8 bits`)
              }
            }
            asm.writeByte(value & 0xff)
          } if (opDef.bc == 3) {
            // TODO: check LREL offset
            asm.writeByte((value >> 0) & 0xff)
            asm.writeByte((value >> 8) & 0xff)
          }
        } else {
          if (opDef.bc >= 2) {
            asm.writeByte(undefined)
            if (opDef.bc >= 3) {
              asm.writeByte(undefined)
            }
          }
        }
      }
    }
  }
}

//#endregion
//==============================================================================
//#region Conditionals
//==============================================================================

export abstract class ConditionalStatement extends Statement {

  // TODO: share with Statement.preprocess?
  public applyConditional(asm: Assembler, conditional: Conditional): void {
    this.forEachExpression((expression) => {
      if (expression instanceof exp.SymbolExpression) {
        asm.processSymbol_pass0(expression)
      } else if (expression instanceof exp.PcExpression) {
        if (this.PC !== undefined) {
          expression.setValue(this.PC)
        } else if (!expression.hasError()) {
          expression.setError("PC not resolvable")
        }
      }
    })
  }
}


// MERLIN:  DO <exp>
//   DASM:  IF <exp>
//   ACME:  !if <exp> { <block> }
//   CA65:  .if <exp>
//   LISA:  .IF <exp>
//          NOTE: LISA does not support nested IF's.
// 64TASS:  .if <exp>

export class IfStatement extends ConditionalStatement {

  private op?: Op

  constructor(op?: Op) {
    super()
    this.op = op
  }

  public override applyConditional(asm: Assembler, conditional: Conditional): void {

    super.applyConditional(asm, conditional)

    if (asm.inMacroDef()) {
      return
    }

    // TODO: fix this hack for ACME inline code
    // TODO: Use a subclass instead?
    if (asm.syntax == Syntax.ACME) {
      const block = this.findArg("block")
      if (block) {
        return
      }
    }

    if (!conditional.push()) {
      this.setError("Exceeded nested conditionals maximum")
      return
    }

    asm.pushNesting(NestingType.Conditional)
    conditional.statement = this

    const expression = this.findArg("condition")
    if (!expression) {
      return
    }

    const condVal = expression.resolve()
    if (condVal === undefined) {
      if (!asm.inMacroDef()) {
        expression.setErrorWeak("Must resolve in first pass")
        return
      }
    }

    conditional.setSatisfied(condVal != 0)
  }

  postProcessSymbols(symUtils: SymbolUtils): void {
    const expression = this.findArg("condition")
    if (expression) {
      symUtils.markConstants(expression)
    }
  }
}


// MERLIN:
//   DASM:  IFCONST <symbol>
//          IFNCONST <symbol>
//   ACME:  !ifdef <symbol> { <block> }
//          !ifndef <symbol> { <block> }
//   CA65:
//   LISA:

export class IfDefStatement extends ConditionalStatement {

  private isTrue: boolean

  constructor(isTrue: boolean) {
    super()
    this.isTrue = isTrue
  }

  public override applyConditional(asm: Assembler, conditional: Conditional): void {

    super.applyConditional(asm, conditional)

    if (asm.inMacroDef()) {
      return
    }

    if (!conditional.push()) {
      this.setError("Exceeded nested conditionals maximum")
      return
    }

    asm.pushNesting(NestingType.Conditional)
    conditional.statement = this

    const isSatisfied = this.checkCondition()
    conditional.setSatisfied(
      (isSatisfied && this.isTrue) || (!isSatisfied && !this.isTrue))
  }

  checkCondition(): boolean {
    const symbolArg = this.findArg("symbol-weakref")
    const symbol = (symbolArg as exp.SymbolExpression)?.symbol
    return symbol !== undefined
  }
}

export class IfConstStatement extends IfDefStatement {
  constructor(isTrue: boolean) {
    super(isTrue)
  }

  checkCondition(): boolean {
    const conditionArg = this.findArg("condition")
    return conditionArg?.resolve() !== undefined
  }
}

// MERLIN:
//   DASM:  ELIF <exp>
//   ACME:
//   CA65:  .elseif <exp>
//   LISA:
// 64TASS:  .elsif <exp>

export class ElseIfStatement extends ConditionalStatement {

  // *** what about folding here? ***

  public override applyConditional(asm: Assembler, conditional: Conditional): void {

    super.applyConditional(asm, conditional)

    if (asm.inMacroDef()) {
      return
    }

    if (conditional.isComplete()) {
      this.setError("Unexpected ELIF without IF")
      return
    }

    if (conditional.statement) {
      conditional.statement.foldEnd = this
    } else {
      this.setError("No matching IF/ELIF statement")
      return
    }

    asm.popNesting()
    asm.pushNesting(NestingType.Conditional)
    conditional.statement = this

    const expression = this.findArg("condition")
    if (!expression) {
      return
    }

    const condVal = expression.resolve()
    if (condVal === undefined) {
      if (!asm.inMacroDef()) {
        expression.setErrorWeak("Must resolve in first pass")
        return
      }
    }

    conditional.setSatisfied(!conditional.wasSatisfied() && condVal != 0)
  }

  postProcessSymbols(symUtils: SymbolUtils): void {
    const expression = this.findArg("condition")
    if (expression) {
      symUtils.markConstants(expression)
    }
  }
}


// MERLIN:  ELSE
//   DASM:  ELSE
//   ACME:  } else {
//   CA65:  .else
//   LISA:  .EL
// 64TASS:  .else

export class ElseStatement extends ConditionalStatement {

  public override applyConditional(asm: Assembler, conditional: Conditional): void {

    super.applyConditional(asm, conditional)

    if (asm.inMacroDef()) {
      return
    }

    if (conditional.isComplete()) {
      this.setError("Unexpected ELSE without IF")
      return
    }

    if (conditional.statement) {
      conditional.statement.foldEnd = this
    } else {
      this.setError("No matching IF statement")
      return
    }

    asm.popNesting()
    asm.pushNesting(NestingType.Conditional)
    conditional.statement = this

    conditional.setSatisfied(!conditional.wasSatisfied())
  }
}

export class AcmeElseStatement extends ElseStatement {
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
}

// MERLIN:  FIN
//   DASM:  ENDIF
//          EIF
//   ACME:  }
//   CA65:  .endif
//   LISA:  .FI
// 64TASS:  .endif
//          .fi

export class EndIfStatement extends ConditionalStatement {

  // only called if brace statement is conditional
  public override applyConditional(asm: Assembler, conditional: Conditional): void {

    super.applyConditional(asm, conditional)

    if (asm.inMacroDef()) {
      return
    }

    if (conditional.statement) {
      conditional.statement.foldEnd = this
    } else {
      this.setError("no matching IF/ELIF statement")
      return
    }

    if (!asm.isNested(NestingType.Conditional)) {
      this.setError("no IF/ELIF statement to end")
      return
    }

    if (asm.topNestingType() != NestingType.Conditional) {
      this.setError("no matching IF/ELIF statement")
      return
    }

    asm.popNesting()
    if (!conditional.pull()) {
      // Merlin ignores unused FIN
      // if (!assembler->SetMerlinWarning("Unexpected FIN/ENDIF")) {
      //   return
      // }
    }
  }
}


export class ClosingBraceStatement extends EndIfStatement {

  // only called if brace statement type is non-conditional
  public override preprocess(asm: Assembler): void {
    super.preprocess(asm)

    asm.popNesting(true)
  }
}

//#endregion
//==============================================================================
//#region Looping
//==============================================================================

// TODO: is label allowed or disallowed?

// MERLIN:  LUP <loop-count>
//   DASM:  REPEAT <loop-count>
//   ACME:  !for <loop-var>, <loop-start>, <loop-end> { <block> }
//          !for <loop-var>, <loop-end> { <block> }
//          !do [<keyword-condition>] { <block> } [<keyword-condition>]
//          TODO: support !do
//   CA65:  .repeat <loop-count> [, <loop-var>]
//   LISA:  n/a
// 64TASS:  .rept <loop-count>
//          .for [<assignment>], [<condition>], [<assignment>]
//          .while <condition>

// MERLIN: ]VAR usage not allowed when LUP is inside macro
// CA65: nested .repeat using same var causes inner var to always be used
// ACME: private vars are used that can't be modified with !set
// ACME: start <= end counts up, start > end counts up
// 64TASS: "b" prefix on loop commands forces new scope on each iteration

export class RepeatStatement extends Statement {

  public override preprocess(asm: Assembler): void {

    if (asm.inMacroDef()) {
      super.preprocess(asm)
      return
    }

    if (this.labelExp) {
      asm.processSymbol_pass0(this.labelExp)
    }

    // push nesting for the first time
    this.repushNesting(asm)

    let loopVar: LoopVar | undefined
    const loopVarArg = this.findArg("loop-var")
    if (loopVarArg && loopVarArg instanceof exp.SymbolExpression) {
      loopVar = asm.initLoopVar(loopVarArg)
      if (!loopVar) {
        return
      }
    }

    // process all remaining symbols
    // *** call asm directly here?
    super.preprocess(asm)

    let startVal: number | undefined
    const startExp = this.findArg("loop-start")
    if (startExp) {
      startVal = startExp.resolve()
      if (startVal === undefined) {
        startExp.setErrorWeak("Must resolve in first pass")
        return
      }
    } else {
      startVal = 1
    }

    let endVal: number | undefined
    const endExp = this.findArg("loop-end")
    if (endExp) {
      endVal = endExp.resolve()
      if (endVal === undefined) {
        endExp.setErrorWeak("Must resolve in first pass")
        return
      }
    } else {
      endVal = 1
    }

    const countExp = this.findArg("loop-count")
    if (countExp) {
      const countVal = countExp.resolve()
      if (countVal === undefined) {
        countExp.setErrorWeak("Must resolve in first pass")
        return
      }
      if (countVal < 0) {
        countExp.setErrorWeak("Invalid count")
        return
      }
      startVal = 0
      endVal = countVal - 1
    }

    // TODO: support loop conditional expressions

    if (startVal === undefined || endVal === undefined) {
      return
    }

    asm.startLoop(startVal, endVal, loopVar)
  }

  private repushNesting(asm: Assembler) {
    asm.pushNesting(NestingType.Repeat, () => {
      if (!asm.endLoop()) {
        // if looping not complete,
        //  repush nesting for next time through
        this.repushNesting(asm)
      }
    })
  }
}

// MERLIN:  --^
//   DASM:  [.]REPEND
//   ACME:  } [<keyword-condition>]
//   CA65:  .endrep[eat]
//   LISA:  n/a
// 64TASS:  .endfor
//          .endrept
//          .endwhile
//          .break,.breakif,.continue,.continueif
//          .next,.lbl,.goto

export class EndRepStatement extends Statement {

  public override preprocess(asm: Assembler): void {

    if (asm.inMacroDef()) {
      super.preprocess(asm)
      return
    }

    // TODO: skip this, unless it's a "do {...} while" for ACME
    super.preprocess(asm)

    if (!asm.isNested(NestingType.Repeat)) {
      this.setError("Ending repeat without a start")
      return
    }
    if (asm.topNestingType() != NestingType.Repeat) {
      this.setError("Mismatched repeat end")
      return
    }

    asm.popNesting(true)   // pass true so pop proc gets called
  }
}

//#endregion
//==============================================================================
//#region Storage
//==============================================================================

// *** mark label as storage ***

// *** others ***

//   LISA:  .DA <exp>[,<exp>]
//          #<expression>
//          /<expression>
//          <expression>
//          "string"
//          'string'

const DataRanges: number[][] = [
  [          0,          0,           0 ],
  [       0xff,       0x7f,       -0x80 ],
  [     0xffff,     0x7fff,     -0x8000 ],
  [   0xffffff,   0x7fffff,   -0x800000 ],
  [ 0xffffffff, 0x7fffffff, -0x80000000 ],
]

// TODO: need to think about handling string constants in here

class DataStatement extends Statement {

  protected dataSize: number
  protected signType: string
  protected bigEndian: boolean

  constructor(dataSize: number, signType: string, bigEndian = false) {
    super()
    this.dataSize = dataSize
    this.signType = signType
    this.bigEndian = bigEndian
  }

  postParse(parser: Parser) {
    if (this.labelExp && this.labelExp instanceof exp.SymbolExpression) {
      const symbol = this.labelExp.symbol
      if (symbol) {
        symbol.isData = true
      }
    }

    // TODO: may not need this -- let actual assembly catch range errors

    const uMax = DataRanges[this.dataSize][0]
    const sMax = DataRanges[this.dataSize][1]
    const sMin = DataRanges[this.dataSize][2]

    for (let arg of this.args) {
      const value = arg.resolve()
      if (value != undefined) {
        if (this.signType == "s") {
          if (value < sMin || value > sMax) {
            arg.setError(`Expression value ${value} out of range ${sMin}..${sMax}`)
          }
        } else if (this.signType == "u") {
          if (value < 0 || value > uMax) {
            arg.setError(`Expression value ${value} out of range 0..${uMax}`)
          }
        } else if (this.signType == "x") {
          if (value < sMin || value > uMax) {
            arg.setError(`Expression value ${value} out of range ${sMin}..${uMax}`)
          }
        }
      }
    }
  }

  public override preprocess(asm: Assembler): void {
    super.preprocess(asm)

    if (asm.module.project.syntax == Syntax.CA65) {
      if (this.args.length == 0) {
        // TODO: only allow no dataElements if inside a .struct
      }
    }
  }

  postProcessSymbols(symUtils: SymbolUtils) {
    // TODO: do for all sizes?
    if (this.dataSize == 1) {
      for (let expression of this.args) {
        symUtils.markConstants(expression)
      }
    }
  }

  pass1(asm: Assembler): number {
    return Math.max(this.args.length, 1) * this.dataSize
  }

  pass2(asm: Assembler) {

    // in DASM, empty data statements are just storage statements
    if (this.args.length == 0) {
      asm.writeBytePattern(0, this.dataSize)
      return
    }

    for (let element of this.args) {
      const value = element.resolve()
      if (value === undefined) {
        asm.writeBytePattern(undefined, this.dataSize)
        continue
      }
      if (this.dataSize == 1) {
        if (asm.syntax == Syntax.CA65) {
          if (value < 0 || value > 255) {
            element.setError(`Value ${value} out of range 0..255`)
          }
        } else if (value > 255 || value < -128) {
          element.setWarning(`Value ${value} overflows 8 bits`)
        }
        asm.writeByte(value & 0xff)
      } else if (this.dataSize == 2) {
        const value0 = (value >> 0) & 0xff
        const value8 = (value >> 8) & 0xff
        if (this.bigEndian) {
          asm.writeByte(value8)
          asm.writeByte(value0)
        } else {
          asm.writeByte(value0)
          asm.writeByte(value8)
        }
      } else {
        // TODO: deal with 24 bit values
      }
    }
  }
}

// TODO: review all syntaxes use of these types
//  (which enforce sign bounds and which don't?)

export class DataStatement_U8 extends DataStatement {
  constructor() {
    super(1, "u", false)
  }
}

export class DataStatement_S8 extends DataStatement {
  constructor() {
    super(1, "s", false)
  }
}

export class DataStatement_X8 extends DataStatement {
  constructor() {
    super(1, "x", false)
  }
}

export class DataStatement_U16 extends DataStatement {
  constructor(bigEndian = false) {
    super(2, "u", bigEndian)
  }
}

export class DataStatement_S16 extends DataStatement {
  constructor(bigEndian = false) {
    super(2, "s", bigEndian)
  }
}

export class DataStatement_X16 extends DataStatement {
  constructor(bigEndian = false) {
    super(2, "x", bigEndian)
  }
}

export class DataStatement_U24 extends DataStatement {
  constructor(bigEndian = false) {
    super(3, "u", bigEndian)
  }
}

export class DataStatement_S24 extends DataStatement {
  constructor(bigEndian = false) {
    super(3, "s", bigEndian)
  }
}

export class DataStatement_X24 extends DataStatement {
  constructor(bigEndian = false) {
    super(3, "X", bigEndian)
  }
}

export class DataStatement_U32 extends DataStatement {
  constructor(bigEndian = false) {
    super(4, "u", bigEndian)
  }
}

export class DataStatement_S32 extends DataStatement {
  constructor(bigEndian = false) {
    super(4, "s", bigEndian)
  }
}

export class DataStatement_X32 extends DataStatement {
  constructor(bigEndian = false) {
    super(4, "X", bigEndian)
  }
}

//------------------------------------------------------------------------------

// MERLIN:  ds <count> [, <fill>]
//          ds \ [, <fill>]
//   DASM:  ds [{.b|.w|.l|.s}] <count> [, <fill> ]
//   ACME:  !fill <count-exp> [, <fill-value>]
//   CA65:  .res <count> [, <fill>]
//   LISA:  dfs <count> [, <fill>]
// 64TASS:  .fill <count> [, <fill>]

export class StorageStatement extends Statement {

  protected dataSize: number
  protected bigEndian: boolean
  private countValue?: number

  constructor(dataSize: number, bigEndian = false) {
    super()
    this.dataSize = dataSize
    this.bigEndian = bigEndian
  }

  postParse(parser: Parser): void {
    if (this.labelExp && this.labelExp instanceof exp.SymbolExpression) {
      const symbol = this.labelExp.symbol
      if (symbol) {
        symbol.isData = true
      }
    }
  }

  public override preprocess(asm: Assembler): void {
    super.preprocess(asm)

    const countArg = this.findArg("count")
    if (countArg) {
      this.countValue = countArg.resolve()
      if (this.countValue === undefined) {
        countArg.setErrorWeak("Must resolve on first pass")
      }
    } else {
      // assume if count isn't found, must be Merlin "\\"
      this.countValue = -(this.PC ?? 0) & 0xFF
    }
  }

  pass1(asm: Assembler): number {
    return (this.countValue ?? 0) * (this.dataSize ?? 0)
  }

  pass2(asm: Assembler): void {
    let fillValue = 0
    const fillArg = this.findArg("fill")
    if (fillArg) {
      const value = fillArg.resolve()
      if (value === undefined) {
        fillArg.setError("Unresolved expression")
        return
      }
      fillValue = value
    }
    // TODO: handle >= 16 bit patterns differently
    const count = (this.countValue ?? 0) * (this.dataSize ?? 0)
    asm.writeBytePattern(fillValue, count)
  }
}

// MERLIN:  n/a
//   DASM:  [.]ALIGN <boundary> [, <fill>]
//   ACME:  !align <and>, <equal> [, <fill>]
//          (default <fill> = $EA)
//   CA65:  .align <boundary> [,<fill>]
//   LISA:  n/a
// 64TASS:  [<boundary>[, {?|<fill>}[, <offset>]]]
//          (default <boundary> = 256)

export class AlignStatement extends Statement {

  private padValue?: number

  public override preprocess(asm: Assembler): void {

    // TODO: DASM assigns label address AFTER the alignment

    super.preprocess(asm)

    const andArg = this.findArg("and")
    const equalArg = this.findArg("equal")
    if (andArg && equalArg) {
      const andValue = andArg.resolve()
      if (andValue === undefined) {
        andArg.setErrorWeak("Must resolve on first pass")
        return
      }
      const equalValue = equalArg.resolve()
      if (equalValue === undefined) {
        equalArg.setErrorWeak("Must resolve on first pass")
        return
      }
      this.padValue = (equalValue - (this.PC ?? 0)) & andValue
      return
    }

    let boundaryValue = 256
    const boundaryArg = this.findArg("boundary")
    if (boundaryArg) {
      const value = boundaryArg.resolve()
      if (value === undefined) {
        boundaryArg.setErrorWeak("Must resolve on first pass")
        return
      }
      boundaryValue = value
    }

    let offsetValue = 0
    const offsetArg = this.findArg("offset")
    if (offsetArg) {
      const value = offsetArg.resolve()
      if (value === undefined) {
        offsetArg.setErrorWeak("Must resolve on first pass")
        return
      }
      offsetValue = value
    }

    const misalign = (this.PC ?? 0) % boundaryValue
    const size = (misalign ? boundaryValue - misalign : 0) + offsetValue
    // TODO: how are negative offsets handled in 64TASS?
    this.padValue = Math.max(size, 0)
  }

  pass1(asm: Assembler): number {
    return this.padValue ?? 0
  }

  pass2(asm: Assembler): void {
    let fillValue = asm.syntax == Syntax.ACME ? 0xEA : 0x00
    const fillArg = this.findArg("fill")
    if (fillArg) {
      const value = fillArg.resolve()
      if (value === undefined) {
        fillArg.setError("Unresolved expression")
      } else {
        fillValue = value
      }
    }
    asm.writeBytePattern(fillValue, this.padValue ?? 0)
  }
}

//------------------------------------------------------------------------------

// MERLIN:  HEX <hex> [, ...]
//   DASM:  [.]HEX <hex> [ ...]
//   ACME:  !HEX <hex> [ ...]
//   CA65:  n/a
//   LISA:  HEX <hex>
// 64TASS:  n/a

// odd digits never allowed
// $ and 0x prefix never allowed

export class HexStatement extends Statement {

  private dataBytes: number[] = []

  postParse(parser: Parser) {
    if (this.labelExp && this.labelExp instanceof exp.SymbolExpression) {
      const symbol = this.labelExp.symbol
      if (symbol) {
        symbol.isData = true
      }
    }
  }

  public override preprocess(asm: Assembler): void {
    super.preprocess(asm)

    this.dataBytes = []
    for (let arg of this.args) {
      if (!arg.hasError()) {
        scanHex(arg.getString(), this.dataBytes)
      }
    }
  }

  // *** needed?
  getSize(): number | undefined {
    return this.dataBytes.length
  }

  pass1(asm: Assembler): number {
    return this.dataBytes.length
  }

  pass2(asm: Assembler): void {
    asm.writeBytes(this.dataBytes)
  }
}

// NOTE: caller has checked for odd nibbles
function scanHex(hexString: string, buffer: number[]) {
  while (hexString.length > 0) {
    const byteStr = hexString.substring(0, 2)
    buffer.push(parseInt(byteStr, 16))
    hexString = hexString.substring(2)
  }
}

//#endregion
//==============================================================================
//#region Disk
//==============================================================================

// *** !convtab here too?

class FileStatement extends Statement {

  protected fileName?: exp.FileNameExpression

  postParse(parser: Parser) {
    this.fileName = this.findArg("filename")
  }

  protected cleanFileName(): string | undefined {
    if (this.fileName) {
      let fileNameStr = this.fileName.getString() || ""
      if (fileNameStr.length > 0) {
        // TODO: only strip quotes for non-Merlin?
        // TODO: require quoting for CA65? other syntaxes?
        let quoteChar = fileNameStr[0]
        if (quoteChar == "'" || quoteChar == '"' || quoteChar == "<") {
          fileNameStr = fileNameStr.substring(1)
          if (fileNameStr.length > 0) {
            const lastChar = fileNameStr[fileNameStr.length - 1]
            if (lastChar == quoteChar || (quoteChar == "<" && lastChar == ">")) {
              fileNameStr = fileNameStr.substring(0, fileNameStr.length - 1)
            }
          }
        }
        return fileNameStr
      }
    }
  }
}

// MERLIN:  PUT filename
//          USE filename
//   DASM:  [.]INCLUDE "filename"
//   ACME:  !SOURCE "filename"
//          !SOURCE <filename>
//   CA65:  .INCLUDE "filename"
//   LISA:  ICL "filename"
// 64TASS:  .include "filename"

export class IncludeStatement extends FileStatement {

  public override preprocess(asm: Assembler): void {
    super.preprocess(asm)

    // TODO: share more of this code
    if (this.fileName) {
      const fileNameStr = this.cleanFileName()
      if (fileNameStr) {
        if (!asm.includeFile(fileNameStr)) {
          this.fileName.setError("File not found")
        }
      }
    }
  }
}

// 64TASS:  [<label>] .binclude "filename"
export class BlockIncludeStatement extends IncludeStatement {
  // TODO: if label present, add named scope around include
  //  else, add anonymous unique scope around include
}

// MERLIN:  SAV filename
//   DASM:  n/a
//   ACME:  n/a
//   CA65:  n/a
//   LISA:  SAV "filename"

export class SaveStatement extends FileStatement {

  public pass2(asm: Assembler): void {

    // TODO: share more of this code
    if (this.fileName) {
      const fileNameStr = this.cleanFileName()
      if (fileNameStr) {
        if (!asm.writeFile(fileNameStr)) {
          this.fileName.setError("File not found")
        }
      }
    }
}
}


// MERLIN:  DSK filename
//   DASM:  n/a
//   ACME:  !TO "filename" [, file-format]
//   CA65:  n/a
//   LISA:  n/a

export class DiskStatement extends FileStatement {
}

// MERLIN:  n/a
//   DASM:  [.]INCDIR "directory"
//   ACME:  n/a
//   CA65:  n/a
//   LISA:  n/a

export class IncDirStatement extends FileStatement {
  // TODO:
}

// MERLIN:  n/a
//   DASM:  [.]INCBIN "filename" [, offset]
//   ACME:  !BINARY "filename" [, [size] [, [offset]]]
//   CA65:  .INCBIN "filename" [, offset [, size]]
//   LISA:  n/a
// 64TASS:  .binary "filename"

export class IncBinStatement extends FileStatement {

  pass1(asm: Assembler): number {
    // TODO: return actual data size
    return 0
  }
}

//#endregion
//==============================================================================
//#region Macros, Structures, Unions, Enums
//==============================================================================

// DefineDefStatement is a greatly simplified version of
//  of TypeDefBeginStatement that doesn't follow the
//  begin/end pattern.

// *** fold-into/derive-from typeDefStatement?
export class DefineDefStatement extends Statement {

  public typeName?: exp.SymbolExpression

  // *** TODO: expressions need be parse manually
  //  *** like macroDef parameters because they
  //  *** may not look valid by themselves

  postParse(parser: Parser) {
    const name = this.findArg("define-name")
    if (name instanceof exp.SymbolExpression) {
      this.typeName = name
    }
  }

  // *** this is no longer marked as inMacroDef
  //  *** because of segments -- more reason to fold into typeDef

  public override preprocess(asm: Assembler) {

    if (this.typeName) {

      // assign typeName's full symbol name before scope changes
      asm.processSymbol_pass0(this.typeName)

      if (this.typeName.symbol) {
        this.typeName.symbol.isZoneStart = true
      }
      asm.scopeState.pushScope(this.typeName.getString())

      // TODO: share with macroDef/typeDef
      // *** move into startTypeDef?
      const typeParams = this.findArgs("define-param")
      const typeParamNames: string[] = []
      for (let typeParam of typeParams) {
        if (typeParam instanceof exp.SymbolExpression) {
          asm.processSymbol_pass0(typeParam)
          typeParamNames.push(typeParam.getString())
        }
      }

      // process remaining symbol expressions
      super.preprocess(asm)

      asm.startTypeDef(NestingType.Define, this.typeName, typeParamNames)
    }
  }

  // specific to DefineDefStatement
  endPreprocess(asm: Assembler) {
    asm.scopeState.popScope()
    asm.endTypeDef(0)
  }
}

//------------------------------------------------------------------------------

export class TypeDefBeginStatement extends Statement {

  protected nestingType: NestingType
  protected canRecurse: boolean
  public typeName?: exp.SymbolExpression

  constructor(nestingType: NestingType, canRecurse: boolean) {
    super()
    this.nestingType = nestingType
    this.canRecurse = canRecurse
  }

  postParse(parser: Parser) {
    const name = this.findArg("type-name")
    if (name instanceof exp.SymbolExpression) {
      this.typeName = name
    } else if (this.labelExp) {
      this.typeName = this.labelExp
      this.typeName.setSymbolType(SymbolType.TypeName)
    }
  }

  public override preprocess(asm: Assembler) {

    if (asm.inMacroDef()) {
      super.preprocess(asm)
      return
    }

    if (!this.canRecurse) {
      if (asm.isNested(this.nestingType)) {
        this.setError("Cannot be restarted")
        return
      }
    }

    // check for anonymous struct and enum
    if (!this.typeName) {
      // *** anonymous type (structure)?
      return  // *** handle separately ***
    }

    // TODO: not needed if scope and proc were split out
    const isStruct = this.nestingType == NestingType.Struct
      || this.nestingType == NestingType.Union

    // *** different if anonymous type?
    if (isStruct) {
      // *** different if already nested in parent type
      const startPC = 0
      asm.pushAndSetStructSegment(startPC)
    }

    asm.pushNesting(this.nestingType, () => {
      const size = isStruct ? asm.popSegment() : 0
      if (asm.syntax == Syntax.ACME) {
        asm.scopeState.popZone()
      } else {
        asm.scopeState.popScope()
      }
      asm.endTypeDef(size)
    })

    // assign typeName's full symbol name before scope changes

    asm.processSymbol_pass0(this.typeName)
    if (this.typeName.hasError()) {
      return
    }

    const typeNameStr = this.typeName!.getString()
    // NOTE: ACME assumes locals inside macro defs
    // *** should this also be done for types or just macros?
    if (asm.syntax == Syntax.ACME) {
      asm.scopeState.pushZone(typeNameStr)
    } else {
      asm.scopeState.pushScope(typeNameStr)
    }

    // type-params are scoped to the type itself
    // *** move into startTypeDef?
    const typeParams = this.findArgs("type-param")
    const typeParamNames: string[] = []
    for (let typeParam of typeParams) {
      if (typeParam instanceof exp.SymbolExpression) {
        asm.processSymbol_pass0(typeParam)
        typeParamNames.push(typeParam.getString())
      }
      // *** how to find defaults?
      // *** set default on symbol?
    }

    asm.startTypeDef(this.nestingType, this.typeName!)
  }
}

export class TypeDefEndStatement extends Statement {
  protected nestingType: NestingType

  constructor(nestingType: NestingType) {
    super()
    this.nestingType = nestingType
  }

  public override preprocess(asm: Assembler): void {

    // don't do any typeDef processing while in a macroDef,
    //  unless this type is itself a macroDef
    if (asm.inMacroDef()) {
      if (this.nestingType != NestingType.Macro) {
        super.preprocess(asm)
        return
      }
    }

    // process possible label before scope change
    if (this.labelExp) {
      asm.processSymbol_pass0(this.labelExp)
    }

    if (!asm.isNested(this.nestingType)) {
      this.setError("Missing begin for this end")
      return
    }

    if (asm.topNestingType() != this.nestingType) {
      this.setError("Dangling scoped type")
      return
    }

    asm.popNesting(true)
  }
}

//------------------------------------------------------------------------------

// MERLIN:  <name> MAC           (label required)
//   DASM:         MAC <name>    (no label allowed)
//                 MACRO <name>
//   ACME:         !macro <name> [<param>,...] {
//   CA65:         .mac <name> [<param>,...]
//                 .macro <name> [<param>,...]
// 64TASS:  <name> .macro [<param>[=<default>],...]
//   LISA:  n/a

// ACME: params start with "." and are locals
// ACME: params starting with "~" are by reference
// ACME: allows overloading of macro name based on param count
// CA65: params are simple symbols
// 64TASS: supports default values for params
// 64TASS: param references start with "\", but not declarations
// ORCA/M: param declarations and references start with "&"
// ORCA/M: macro definition is on line after "macro" opcode
// DASM: macro generates implicit SUBROUTINE
// DASM: macros can be redefined

export class MacroDefStatement extends TypeDefBeginStatement {

  constructor() {
    super(NestingType.Macro, false)
  }

  public override postParse(parser: Parser) {
    const name = this.findArg("macro-name")
    if (name instanceof exp.SymbolExpression) {
      this.typeName = name
    } else if (this.labelExp) {
      this.typeName = this.labelExp
      this.typeName.setSymbolType(SymbolType.MacroName)
    }
  }

  public override preprocess(asm: Assembler): void {

    if (!this.canRecurse) {
      if (asm.isNested(this.nestingType)) {
        this.setError("Nested macro definitions not allowed")
        return
      }
    }

    // redundent (but harmless) after recursion check
    // if (asm.inMacroDef()) {
    //   return
    // }

    asm.pushAndSetMacroSegment()

    asm.pushNesting(this.nestingType, () => {
      const size = asm.popSegment()
      if (asm.syntax == Syntax.ACME || asm.syntax == Syntax.DASM) {
        asm.scopeState.popZone()
      }
      asm.scopeState.popScope()
      asm.endTypeDef(size)
    })

    if (!this.typeName) {
      return
    }

    // assign typeName's full symbol name before scope changes
    // NOTE: isMacroDef is NOT true yet
    asm.processSymbol_pass0(this.typeName)
    if (this.typeName.hasError()) {
      return
    }

    const typeNameStr = this.typeName!.getString()
    // NOTE: ACME assumes locals inside macro defs
    asm.scopeState.pushScope(typeNameStr)
    if (asm.syntax == Syntax.ACME || asm.syntax == Syntax.DASM) {
      asm.scopeState.pushZone(typeNameStr)
    }

    // *** ACME macro params start with "." and are assumed to be locals
    // *** ACME support "~" prefix meaning "by reference"

    // *** type-params are scoped to the type itself
    // *** move into startTypeDef?
    const typeParams = this.findArgs("type-param")
    const typeParamNames: string[] = []
    for (let typeParam of typeParams) {
      if (typeParam instanceof exp.SymbolExpression) {
        asm.processSymbol_pass0(typeParam)
        typeParamNames.push(typeParam.getString())
      }
      // *** how to find defaults?
      // *** set default on symbol?
    }

    // TODO: DASM: macros can be redefined so watch for duplicate symbol
    asm.startTypeDef(this.nestingType, this.typeName, typeParamNames)
  }
}

// MERLIN:  EOM       (label is allowed)
//          <<<
//   DASM:  ENDM      (no label allowed)
//   ACME:  }
//   CA65:  .endmacro
//          .endmac
// 64TASS:  .endmacro
//          .endm
//   LISA:  n/a

export class EndMacroDefStatement extends TypeDefEndStatement {

  constructor() {
    super(NestingType.Macro)
  }
}

//------------------------------------------------------------------------------

//  CA65: .enum [<type-name>]

export class EnumStatement extends TypeDefBeginStatement {
  constructor() {
    super(NestingType.Enum, false)  // cannot nest
  }

  public override preprocess(asm: Assembler) {

    if (asm.inMacroDef()) {
      super.preprocess(asm)
      return
    }

    if (!this.canRecurse) {
      if (asm.isNested(this.nestingType)) {
        this.setError("Cannot be restarted")
        return
      }
    }

    const startPC = 0
    asm.pushAndSetEnumSegment(startPC)

    const typeNameStr = this.typeName?.getString() ?? ""

    asm.pushNesting(this.nestingType, () => {
      const size = asm.popSegment()
      if (typeNameStr) {
        if (asm.syntax == Syntax.ACME) {
          asm.scopeState.popZone()
        } else {
          asm.scopeState.popScope()
        }
      }
      asm.endTypeDef(size)
    })

    // assign typeName's full symbol name before scope changes

    if (this.typeName) {
      asm.processSymbol_pass0(this.typeName)
      if (this.typeName.hasError()) {
        return
      }
    }

    if (typeNameStr) {
      if (asm.syntax == Syntax.ACME) {
        asm.scopeState.pushZone(typeNameStr)
      } else {
        asm.scopeState.pushScope(typeNameStr)
      }
    }

    asm.startTypeDef(this.nestingType, this.typeName)
  }
}

export class EnumValueStatement extends Statement {

  private value?: exp.Expression

  public parse(parser: Parser): void {
    if (this.labelExp) {
      const res = parser.mustAddToken(["", "="])
      if (res.index < 0) {
        return
      }
      if (res.index == 1) {
        this.value = parser.mustAddNextExpression()
        if (this.value) {
          this.labelExp.symbol?.setValue(this.value, SymbolFrom.Equate)
        }
      }
      this.labelExp.symbol!.isConstant = true
    }
  }

  public pass1(asm: Assembler): number {
    if (this.value) {
      const n = this.value.resolve()
      if (n === undefined) {
        this.value.setError("Must resolve in first pass")
        return 0
      }
      return n - this.PC!
    }
    return 1
  }
}

export class EndEnumStatement extends TypeDefEndStatement {
  constructor() {
    super(NestingType.Enum)
  }
}

//------------------------------------------------------------------------------

export class StructStatement extends TypeDefBeginStatement {
  constructor() {
    super(NestingType.Struct, true)  // can nest
  }
}

export class EndStructStatement extends TypeDefEndStatement {
  constructor() {
    super(NestingType.Struct)
  }
}

export class UnionStatement extends TypeDefBeginStatement {
  constructor() {
    super(NestingType.Union, true)  // TODO: can nest?
  }
}

export class EndUnionStatement extends TypeDefEndStatement {
  constructor() {
    super(NestingType.Union)
  }
}

//------------------------------------------------------------------------------

// TODO: proc and scope belong elsewhere, in scoping group

export class ProcStatement extends TypeDefBeginStatement {
  constructor() {
    super(NestingType.Proc, true) // can nest
  }
}

export class EndProcStatement extends TypeDefEndStatement {
  constructor() {
    super(NestingType.Proc)
  }
}

export class ScopeStatement extends TypeDefBeginStatement {
  constructor() {
    super(NestingType.Scope, true) // can nest
  }
}

export class EndScopeStatement extends TypeDefEndStatement {
  constructor() {
    super(NestingType.Scope)
  }
}

//#endregion
//==============================================================================
//#region Everything else
//==============================================================================

// MERLIN:  <label> <macro> [<param>;...]
//   DASM:  <label> <macro> [<param>, ...]
//   ACME:  <label> +<macro> [<param>, ...]
//   CA65:  <label> <macro> [<param>, ...]
// 64TASS:  <label> (#|.)<macro> [<param>, ...]
//   LISA:  n/a
export class MacroInvokeStatement extends Statement {

  parse(parser: Parser) {
    let expressionOpen = false
    while (true) {

      let token = parser.getNextToken()
      if (!token) {
        if (expressionOpen) {
          this.flushExpression(parser)
        }
        break
      }

      const str = token.getString().toLowerCase()

      // TODO: fix this multi-statement hack to suppress errors
      // if (parser.syntax == Syntax.ACME) {   // HACK
      //   if (str == ":") {
      //     parser.ungetToken(token)
      //     if (expressionOpen) {
      //       this.flushExpression(parser)
      //     }
      //     break
      //   }
      // }

      // TODO: hacks to allow macros to look like opcodes
      if (parser.syntax == Syntax.CA65) {   // HACK
        if (str == ":") {
          const expression = parser.parseCA65Local(token, false)
          expression.name = "macro-param"
          parser.addExpression(expression)
          this.args.push(expression)
          continue
        }
      }

      if (parser.syntaxDef.macroInvokeDelimiters.includes(str)) {
        if (!expressionOpen) {
          parser.startExpression()
        }
        this.flushExpression(parser)

        // make Merlin delimiter stand out a little bit since
        //  there can't be any space around it
        if (str == ";") {
          token.type = TokenType.Keyword
        }

        parser.addToken(token)
        parser.startExpression()
        expressionOpen = true
        continue
      }

      if (!expressionOpen) {
        parser.startExpression()
        expressionOpen = true
      }

      // help make macros look like real opcodes when using addressing modes
      if (str == "x" || str == "y") {
        token.type = TokenType.Opcode
        parser.addToken(token)
        continue
      }

      const position = parser.getPosition()
      const expression = parser.parseExpression(token)
      if (!expression || expression.hasAnyError()) {
        parser.setPosition(position)
        parser.addToken(token)
        TokenType
      } else {
        parser.addExpression(expression)
      }
    }
  }

  private flushExpression(parser: Parser) {
    const expression = new exp.Expression(parser.endExpression())
    expression.name = "macro-param"
    parser.addExpression(expression)
    this.args.push(expression)
  }

  public override preprocess(asm: Assembler): void {

    // process possible label before scope change
    if (this.labelExp) {
      asm.processSymbol_pass0(this.labelExp)
    }

    // *** don't invoke if syntax has not been chosen?

    const macroExp = (this.opExp as exp.SymbolExpression)!

    asm.processSymbol_pass0(macroExp)
    if (macroExp.hasError()) {
      return
    }

    const macroSym = asm.module.symbolMap.get(macroExp.fullName!)
    if (!macroSym) {
      // *** error, unknown macro ***
      return
    }

    if (asm.inMacroDef()) {
      return
    }

    const macroDef = <TypeDef>(macroSym as any).typeDef
    if (!macroDef) {
      // *** error
      return
    }

    asm.invokeMacro(macroDef)
    const varMap = asm.macroInvokeState!.varMap

    const paramValues = this.findArgs("macro-param")

    // default vars 1 to 9
    for (let i = 0; i < paramValues.length; i += 1) {
      const paramName = (i + 1).toString()
      varMap.set(paramName, paramValues[i].getString())
    }

    // TODO: make this a setting
    if (asm.syntax == Syntax.CA65 ||
        asm.syntax == Syntax.ACME ||
        asm.syntax == Syntax.TASS64 ||
        asm.syntax == Syntax.ORCAM) {

      for (let i = 0; i < macroDef.params.length; i += 1) {
        if (i >= paramValues.length) {
          // *** missing param error ***
          continue
        }
        // *** watch for undefined params ***
        // *** convert names based on syntax ***
        varMap.set(macroDef.params[i], paramValues[i].getString())
      }

      for (let i = macroDef.params.length; i < paramValues.length; i += 1) {
        paramValues[i].setError("Unexpected macro parameter")
      }

      // TODO: 64tass supports default values

    } else if (asm.syntax == Syntax.MERLIN) {

      // In Merlin16, ]0 is count of parameters passed to macro
      varMap.set("0", paramValues.length.toString())

    } else if (asm.syntax == Syntax.DASM) {

      // TODO: "{0}" is the entire macro instantiation line
    }
  }
}

//------------------------------------------------------------------------------

// *** watch for assigning a value to a local label
//  *** LISA, for example, doesn't allow that
// *** mark symbol as being assigned rather than just a label?

// *** check if inside enum and adjust PC ***

// MERLIN: symbol EQU [#]exp
//         symbol = exp
// DASM:   symbol [.]EQU [#]exp
//         symbol = exp
// CA65:   symbol = exp
//         symbol := exp

export class EquStatement extends Statement {

  private value?: exp.Expression

  parse(parser: Parser) {
    if (!this.labelExp) {
      parser.insertMissingLabel()
      return
    }
    if (!this.labelExp.isVariableType()) {
      // look for leading "#" for DASM and Merlin
      //  TODO: should this be done for expressions in general?
      // *** (not working in syntax definitions) ***
      if (!parser.syntax
          || parser.syntax == Syntax.DASM
          || parser.syntax == Syntax.MERLIN) {
        const token = parser.peekNextToken()
        if (token && token.getString() == "#") {
          parser.addNextToken()
        }
      }
      this.value = parser.mustAddNextExpression()
      // TODO: if ":=", mark symbol as address
      // TODO: deal with ":?=" conditional assignment
      this.labelExp.symbol?.setValue(this.value, SymbolFrom.Equate)

    } else {
      this.labelExp.setError("Variable label not allowed")
    }
  }

  public override preprocess(asm: Assembler): void {
    this.forEachExpression((expression) => {
      if (expression instanceof exp.SymbolExpression) {
        asm.processSymbol_pass0(expression)

        // watch out for an equate referencing itself
        if (expression != this.labelExp) {
          if (expression.symbol == this.labelExp?.symbol) {
            expression.setError("Circular symbol reference")
            expression.symbol = undefined
          }
        }
      } else if (expression instanceof exp.PcExpression) {
        if (this.PC !== undefined) {
          expression.setValue(this.PC)
        } else if (!expression.hasError()) {
          expression.setError("PC not resolvable (no org?)")
        }
      }
    })
  }
}

// MERLIN: varSymbol = exp
// DASM:   varSymbol [.]SET exp
// ACME:             !SET varSymbol = exp
// CA65:   varSymbol .SET exp

export class VarAssignStatement extends Statement {

  private value?: exp.Expression

  parse(parser: Parser) {

    const varExp = this.labelExp
    if (this.opNameLC == "!set") {
      // TODO: fix this
      parser.getNextToken()   // var symbol
      parser.getNextToken()   // "="
    } else {
      if (!this.labelExp) {
        parser.insertMissingLabel()
        return
      }
      if (this.opNameLC == "set" || this.opNameLC == ".set") {
        // NOTE: In DASM, for example, symbol could be a zoneLocal
      } else if (this.opNameLC != "=") {
        this.opExp?.setError("Expecting '='")
        return
      }
    }

    this.value = parser.mustAddNextExpression()
    const varSym = varExp?.symbol
    if (varSym) {
      varSym.setValue(this.value, SymbolFrom.Equate)
      varSym.isMutable = true
    }
  }

  public override preprocess(asm: Assembler) {

    // process all symbols except label
    this.forEachExpression((expression) => {
      if (expression instanceof exp.SymbolExpression) {
        if (expression != this.labelExp) {
          asm.processSymbol_pass0(expression)
        }
      } else if (expression instanceof exp.PcExpression) {
        if (this.PC !== undefined) {
          expression.setValue(this.PC)
        } else if (!expression.hasError()) {
          expression.setError("PC not resolvable")
        }
      }
    })

    if (this.labelExp) {
      asm.processSymbol_pass0(this.labelExp)
    }
  }
}

//------------------------------------------------------------------------------

// MERLIN:  XC [OFF]
//   DASM:  [.]PROCESSOR <type>
//   ACME:  !cpu <type> [ { <block> } ]
//   CA65:
//   LISA:  n/a
// 64TASS:  .cpu "<type>"

export class CpuStatement extends Statement {

  private pushState = false

  postParse(parser: Parser) {
    this.pushState = this.hasTrailingOpenBrace()
  }

  public override preprocess(asm: Assembler) {
    super.preprocess(asm)

    if (this.pushState) {
      asm.pushNesting(NestingType.Cpu, () => {
        // TODO: update cpu state
      })
    }
  }
}


// *** VirtualOrgStatement?  Switch merlin to virtual? ***
export class OrgStatement extends Statement {

  private fillAmount = 0

  public override preprocess(asm: Assembler): void {
    super.preprocess(asm)

    const valueArg = this.args[0]
    if (valueArg) {
      const orgValue = valueArg.resolve()
      if (orgValue === undefined) {
        valueArg.setErrorWeak("Must resolve in first pass")
      } else if (orgValue < 0 || orgValue > 0xFFFF) {
        valueArg.setError("Invalid org value " + orgValue)
      } else {
        // TODO: does only Merlin treat this as a virtual PC?
        const isVirtual = asm.syntax == Syntax.MERLIN
        this.fillAmount = asm.setNextOrg(orgValue, isVirtual)
      }
    } else {
      // TODO: Merlin treats an org with address as a reorg
      //  to sync back to the previous org
    }
  }

  public pass1(asm: Assembler): number {
    return this.fillAmount
  }

  public pass2(asm: Assembler): void {
    if (this.fillAmount > 0) {
      // TODO: 0xFF is the DASM ORG fill value, what about others?
      asm.writeBytePattern(0xFF, this.fillAmount)
    }
  }
}

//------------------------------------------------------------------------------

// MERLIN:   <label> ENT
// MERLIN16:         ENT <symbol>[, <symbol> ...]

export class EntryStatement extends Statement {

  postParse(parser: Parser) {
    if (this.labelExp) {
      if (this.labelExp.isVariableType()) {
        this.labelExp.setError("Variable label not allowed")
        return
      }
      // TODO: will be forced to definition?
      this.labelExp.setIsExport()
    }
    // TODO: else merlin 16 format
  }
}

// MERLIN:   <label> EXT
// MERLIN16:         EXT <symbol>[, <symbol> ...]

export class ExternStatement extends Statement {

  postParse(parser: Parser) {
    if (this.labelExp) {
      if (this.labelExp.isVariableType()) {
        this.labelExp.setError("Variable label not allowed")
        return
      }
      // TODO: will be forced to weak definition?
      this.labelExp.setIsImport()
    }
    // TODO: else merlin 16 format
  }
}

// CA65:  .IMPORT <name>[:<mode>] [, ...]
//        .EXPORT <name>[:<mode>] [, ...]
//        .IMPORTZP <name> [, ...]
//        .EXPORTZP <name>[, ...]

export class ImportExportStatement extends Statement {

  private isExport: boolean
  private isZpage: boolean

  constructor(isExport: boolean, isZpage: boolean) {
    super()
    this.isExport = isExport
    this.isZpage = isZpage
  }
}

//------------------------------------------------------------------------------

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
        const strExpression = parser.parseStringExpression(token, parser.syntaxDef.stringEscapeChars, false)
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

//------------------------------------------------------------------------------

// type TextEncoder = (inBytes: number[], singleQuote: boolean) => number[]

// ascii
// mapped
// merlin-ascii
// merlin-ascii-inv
// merlin-ascii-flashing

// MERLIN:  ASC <string-args>   // params: "<string>[, <hex>]"  <hl-ascii> <optional-hex>
//          DCI <string-args>   // params: "<string>[, <hex>]"  <hl-asciI> <optional-hex>
//          INV <string-args>   // params: "<string>[, <hex>]"  <hl-ascii> <optional-hex> (inverted)
//          FLS <string-args>   // params: "<string>[, <hex>]"  <hl-ascii> <optional-hex> (blinking)
//          REV <string-args>   // params: "<string>[, <hex>]"  <hl-ascii-reversed> <optional-hex>
//          STR <string-args>   // params: "<string>[, <hex>]"  <ascii-length> <hl-ascii> <optional-hex>
//          TXT <naja-string>   // params: "<string>"           <naja> $8D
//          TXC <naja-string>   // params: "<string>"           <naja>
//          TXI <naja-string>   // params: "<string>"           <najA>
// DASM:    ??? (implict in data statements?)
// ACME:    !pet <string-args>
//          !raw <string-args>
//          !scr <string-args>
//          !scrxor <string-args>
//          !text <string-args>
// CA65:    .asciiz <string-args> // params: "<str>[, <str> ...]"    <map-ascii> [<map-ascii> ...] 00
//          .literal <string-args> // params: "<exp>[, <exp> ...]"   <ascii>
//          .byte (implicit)                                         <map-ascii>
// LISA:    asc <string>          // params: "<string>"         <hl-ascii>
//          str <string>          // params: "<string>"         <ascii-length> <hl-ascii>
//          dci <string>          // params: "<string>"         <hl-asciI>
//          inv <string>          // params: "<string>"         <hl-ascii> (inverted)
//          blk <string>          // params: "<string>"         <hl-ascii> (blinking)
// 64TASS:  .text <string-args>   // "<expression>[, <expression> ...]"   // <enc-ascii>
//          .shift <string-args>  // "<expression>[, <expression> ...]"   // <enc-ascii-7bit>
//          .shiftl <string-args> // "<expression>[, <expression> ...]"   // <enc-ascii-7bit>-leftshift>
//          .null <string-args>   // "<expression>[, <expression> ...]"   // <enc-ascii> [<ascii> ..] 00
//          .ptext <string-args>  // "<expression>[, <expression> ...]"   // <enc-ascii-length> <ascii>
//          .byte (implicit)
// ORCA/M   dc (implicit)

// TODO: make this the basis for all the various string/text statements
// TODO: move mapping functionality into StringExpression

export class TextStatement extends Statement {

  protected dataBytes?: number[]

  constructor(private highLow: boolean = true, private mapped: boolean = false, private terminator?: number) {
    super()
  }

  pass1(asm: Assembler): number {

    this.dataBytes = []
    const strExp = this.findArg("expression") // *** "string"
    if (strExp && strExp instanceof exp.StringExpression) {
      const str = strExp.getString()
      const firstChar = str[0]
      const lastChar = str[str.length - 1]
      const setHigh = firstChar == '"'
      const endMark = str.length - (firstChar == lastChar ? 1 : 0)

      this.dataBytes = stringToBytes(str.substring(1, endMark))

      // TODO: this will eventually come from assembler state
      if (this.mapped) {
        const mapping = this.getMapping()

        for (let i = 0; i < this.dataBytes.length; i += 1) {
          this.dataBytes[i] = mapping[this.dataBytes[i]]
          // TODO: apply error if character not mapable?
        }
      }

      if (this.highLow && setHigh) {
        for (let i = 0; i < this.dataBytes.length; i += 1) {
          this.dataBytes[i] |= 0x80
        }
      }

      if (this.terminator !== undefined) {
        if (this.terminator == -1) {
          if (this.dataBytes.length > 0) {
            this.dataBytes[this.dataBytes.length - 1] ^= 0x80
          }
        } else {
          this.dataBytes.push(this.terminator)
        }
      }

      // TODO: optional hex, invert, flash, reverse, etc.

    } else {
      // TODO: handle other expression types
    }

    return this.dataBytes.length
  }

  public pass2(asm: Assembler): void {
    // TODO: Handle case where complex expressions that
    //  forward reference symbols won't be resolve until now.
    if (this.dataBytes) {
      asm.writeBytes(this.dataBytes)
    }
  }

  protected getMapping(): number[] {
    // TODO: fix this
    return []
  }
}

export class NajaTextStatement extends TextStatement {

  private najaMapping?: number[]

  constructor(terminator?: number) {
    super(false, true, terminator)
  }

  protected override getMapping(): number[] {
    if (!this.najaMapping) {
      this.najaMapping = new Array(128)

      for (let i = 0; i < 10; i += 1) {
        this.najaMapping[0x30 + i] = 0x00 + i // numbers
      }

      this.najaMapping[0x20] = 0x0A           // space
      this.najaMapping[0x5F] = 0x0A           // space (underscore)

      for (let i = 0; i < 26; i += 1) {
        this.najaMapping[0x41 + i] = 0x0B + i // letters
      }

      const symbols = "!\"%\'*+,-./:<=>?"     // symbols
      for (let i = 0; i < symbols.length; i += 1) {
        this.najaMapping[symbols.charCodeAt(i)] = 0x25 + i
      }

      this.najaMapping[0x0A] = 0x8B           // \n
    }
    return this.najaMapping
  }
}

function stringToBytes(str: string): number[] {
  const bytes: number[] = []
  let offset = 0
  while (offset < str.length) {
    let value = str.charCodeAt(offset)
    if (str[offset] == '\\') {
      offset += 1
      if (offset < str.length) {
        switch (str[offset]) {
          case '"':
          case "'":
          case "\\":
            value = str.charCodeAt(offset)
            break
          case "t":
            value = 9
            break
          case "n":
            value = 10
            break
          case "r":
            value = 13
            break
          case "x":
            const hexStr: string = str[offset + 1] + str[offset + 2]
            offset += 2
            if (offset > str.length) {
              // TODO: report error on incomplete x escape
              value = 255
              break
            }
            value = parseInt(hexStr, 16)
            if (isNaN(value)) {
              // TODO: report error on bad x escape
              value = 255
              break
            }
            break
          default:
            // TODO: report error on unknown escape
            value = 255
            break
        }
      } else {
        // TODO: report error of dangling escape?
      }
    }
    bytes.push(value & 0x7f)
    offset += 1
  }
  return bytes
}

//------------------------------------------------------------------------------

export class DummyStatement extends Statement {

  postParse(parser: Parser) {
    // TODO: put back in once Naja code is cleaned up
    // if (this.opNameLC == "dummy") {
    //   this.opExp?.setWarning("Use DUM instead")
    // }
  }

  public override preprocess(asm: Assembler): void {

    // NOTE: With Merlin, the start of a dummy section implicitly
    //  closes any currently active dummy section first.
    // TODO: consider controlling this with a strict/lax switch
    if (asm.module.project.syntax == Syntax.MERLIN) {
      if (asm.isNested(NestingType.Struct)) {
        asm.popNesting(true)
      }
    }

    asm.pushNesting(NestingType.Struct, () => {
      asm.popSegment()
    })

    // reference any symbols that may be needed to resolve orgValue
    super.preprocess(asm)

    const valueArg = this.args[0]
    if (valueArg) {
      let orgValue = valueArg.resolve()
      if (orgValue === undefined) {
        valueArg.setErrorWeak("Must resolve in first pass")
        orgValue = 0
      }

      asm.pushAndSetDummySegment(orgValue)
    }
  }
}

export class DummyEndStatement extends Statement {

  public override preprocess(asm: Assembler): void {
    super.preprocess(asm)

    if (!asm.isNested(NestingType.Struct)) {
      this.setError("Missing begin for this dummy")
      return
    }

    if (asm.topNestingType() != NestingType.Struct) {
      this.setError("Dangling scoped type")
      return
    }

    asm.popNesting(true)      // pass true so pop proc gets called
  }
}


// DASM:  SEG[.U] [<name>]
// CA65:  .segment "<name>" [: (direct|zeropage|absolute)]
//                          "direct" means immediate

// ORCA/M:  <name> start [<loadseg>]
// 64TASS:  section <name>
//          dsection <name>

export class SegmentStatement extends Statement {

  private segName?: string

  constructor(segName?: string) {
    super()
    this.segName = segName
  }

  public override preprocess(asm: Assembler): void {

    super.preprocess(asm)

    // TODO: DASM: label on segment assigned after segment change

    let addressing = "implicit"
    let initialized = true

    // DASM specific
    if (this.opNameLC == "seg.u") {
      initialized = false
    }

    // TODO: "quoted-name" for some syntaxes
    const segNameArg = this.findArg("seg-name") // *** quoted string in other syntaxes
    if (segNameArg) {
      this.segName = segNameArg.getString()
    } else {
      // TODO: DASM-only?, when no game is given -- same as default
      this.segName = "code"
    }

    asm.setSegment(this.segName, addressing, initialized)
  }
}

// TODO: EndSegmentStatement
// ORCA/M:  end
//  64TASS: endsection [<name>]
//          send [<name>]

//------------------------------------------------------------------------------

export class ListStatement extends Statement {
}

//==============================================================================
// CA65-only
//==============================================================================

// .feature labels_without_colons
// .feature bracket_as_indirect
// TODO: others

export class FeatureStatement extends Statement {

  postParse(parser: Parser) {
    // TODO: check all args for valid feature names
  }
}

//------------------------------------------------------------------------------

export class AssertTrueStatement extends Statement {

  private typeName?: string
  private always: boolean
  private assertTrue: boolean

  constructor(typeName?: string, always = false, assertTrue = true) {
    super()
    this.typeName = typeName
    this.always = always
    this.assertTrue = assertTrue
  }

  // TODO: should argument parsing/capture be done in preprocess instead?

  // NOTE: Can't commit to error until pass2,
  //  after forward references are resolved, for example.
  pass2(asm: Assembler): void {

    let assertArg: exp.Expression | undefined
    let assertCond = !this.assertTrue
    if (!this.always) {

      assertArg = this.findArg("condition")
      if (assertArg) {
        const value = assertArg.resolve()
        if (assertCond === undefined) {
          // TODO: decide to ignore or trigger when condition not resolved
          return
        }
        assertCond = value != 0
      }
    }

    if (assertCond != this.assertTrue) {

      let type = this.typeName
      if (!type) {
        const typeArg = this.findArg("assert-type")
        if (typeArg) {
          type = typeArg.getString()
        } else {
          type = "error"
        }
      }

      const error = (type == "error" || type == "lderror" || type == "fatal")
      const warning = (type == "warning" || type == "ldwarning")
      if (error || warning) {

        let message = ""
        this.forEachExpression((expression) => {
          if (expression.name == "message" ||
              expression.name == "string-value" ||
              expression instanceof exp.StringExpression) {
            message += expression.getString()
          }
        })

        if (error) {
          (assertArg ?? this).setError("ERROR: " + message)
        } else {
          (assertArg ?? this).setWarning("Warning: " + message)
        }
      }
    }
  }
}

export class AssertFalseStatement extends AssertTrueStatement {
  constructor(type?: string) {
    super(type, false, false)
  }
}

//==============================================================================
// DASM-only
//==============================================================================

// MERLIN:
//   DASM:  [<label>] SUBROUTINE    (label is optional)
//   ACME:  (see !zone below)
//   CA65:
//   LISA:

export class SubroutineStatement extends Statement {

  postParse(parser: Parser) {
    if (!this.labelExp) {
      // insert implied label
      this.labelExp = new exp.SymbolExpression([], SymbolType.Simple, true,
        parser.sourceFile, parser.lineNumber)
      this.children.unshift(this.labelExp)
    }
    if (this.labelExp.isVariableType()) {
      this.labelExp.setError("Variable not allowed as label")
      return
    }
    if (this.labelExp.symbol) {
      this.labelExp.symbol.isZoneStart = true
    }
  }
}

//==============================================================================
// ACME-only
//==============================================================================

// TODO: all of these may need a preprocess_disabled method
//  See ZoneStatement.preprocess_disabled example

//   ACME:  <label> !zone [<name>] [ { <block> } ]
//          <label> !zn [<name>] [ { <block> } ]

export class ZoneStatement extends Statement {

  private zoneTitle?: string
  private pushState = false

  postParse(parser: Parser) {

    this.pushState = this.hasTrailingOpenBrace()

    const zoneArg = this.findArg("name")
    if (zoneArg instanceof exp.SymbolExpression) {
      if (zoneArg.symbol) {
        zoneArg.symbol.isZoneStart = true
      }
      this.zoneTitle = zoneArg.getString()
    }

    if (this.zoneTitle) {
      // TODO: use zoneTitle as scope name
      // TODO: support switching back to a previously used zone title
    } else {
      // if no zone title, use label
      // if no label, insert an implied label
      if (!this.labelExp) {
        // insert implied label
        this.labelExp = new exp.SymbolExpression([], SymbolType.Simple, true,
          parser.sourceFile, parser.lineNumber)
        this.children.unshift(this.labelExp)
      }
      if (this.labelExp.symbol) {
        this.labelExp.symbol.isZoneStart = true
      }
    }
  }

  // TODO: preprocess_disabled?
  //  (push nesting so there's something to pop?)
  // public override preprocess_disabled(asm: Assembler) {
  //   super.preprocess_disabled(asm)
  //
  //   if (this.pushState) {
  //     asm.pushNesting(NestingType.Zone, () => {
  //     })
  //   }
  // }

  public override preprocess(asm: Assembler) {
    super.preprocess(asm)

    if (this.pushState) {
      asm.pushNesting(NestingType.Zone, () => {
        asm.scopeState.popZone()
      })

      asm.scopeState.pushZone(this.zoneTitle)
    } else {
      asm.scopeState.setZone(this.zoneTitle)
    }
  }
}

//   ACME:  <label> !pseudopc <expresion> { <block> }
// TODO: consider folding into OrgStatement?
export class PseudoPcStatement extends Statement {

  // TODO: preprocess_disabled?

  public override preprocess(asm: Assembler) {
    super.preprocess(asm)

    asm.pushNesting(NestingType.PseudoPc, () => {
      // TODO: pop behaviour
    })

    // TODO: actually change PC
  }
}

//   ACME:  !xor expression [ { <block> } ]

export class XorStatement extends Statement {

  private pushState = false

  postParse(parser: Parser) {
    this.pushState = this.hasTrailingOpenBrace()
  }

  public override preprocess(asm: Assembler) {
    super.preprocess(asm)

    if (this.pushState) {
      asm.pushNesting(NestingType.Xor, () => {
        // TODO: manage xor value state
      })
    }

    // TODO: manage xor value state
  }
}

//   ACME:  !address expression [ { <block> } ]
//          !addr

export class AddressStatement extends Statement {

  private pushState = false

  postParse(parser: Parser) {
    this.pushState = this.hasTrailingOpenBrace()
  }

  public override preprocess(asm: Assembler) {
    super.preprocess(asm)

    if (this.pushState) {
      asm.pushNesting(NestingType.Addr, () => {
        // TODO: manage addr state
      })
    }

    // TODO: manage addr state
  }
}

//   ACME:  !convtab {pet|raw|scr|<filename>} [\\{ [<block> \\}]]

export class ConvTabStatement extends Statement {

  private pushState = false

  postParse(parser: Parser) {
    this.pushState = this.hasTrailingOpenBrace()
  }

  public override preprocess(asm: Assembler) {
    super.preprocess(asm)

    if (this.pushState) {
      asm.pushNesting(NestingType.ConvTab, () => {
        // TODO: manage converstion table state
      })
    }

    // TODO: manage converstion table state
  }
}

//#endregion
//==============================================================================
