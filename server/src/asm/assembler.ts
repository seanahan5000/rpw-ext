
import { PcExpression, SymbolExpression } from "./expressions"
import { Module, LineRecord } from "./project"
import { GenericStatement } from "./statements"
import { Syntax, SyntaxDef } from "./syntaxes/syntax_types"

// - update while typing

// - DS \,$EE

// - "DENIBBLE_TABLE  =   *-$96" not resolving

// - ignore macro body
// - org $00/ds 1 not treated as zpage
// - Dummy and SEG.U not working
// - DASM: "SEG" without name gives error
// - line with errors should give ??
// - restore PC after dummy

// - macro invoke
// - compare against .lst data

//------------------------------------------------------------------------------

export class Assembler {

  public module: Module
  private currentPC = -1
  private currentLine?: LineRecord

  constructor(module: Module) {
    this.module = module
  }

  public setPC(newPC: number) {
    this.currentPC = newPC
  }

  public getPC(): number {
    return this.currentPC
  }

  public get syntax(): Syntax {
    return this.module.project.syntax
  }

  public get syntaxDef(): SyntaxDef {
    return this.module.project.syntaxDef
  }

  public assemble(lineRecords: LineRecord[]) {

    // TODO: change this to undefined once structure offsets work?
    this.currentPC = this.module.project.syntaxDef.defaultOrg

    // pass 1

    for (let line of lineRecords) {
      const statement = line.statement
      if (!statement || !statement.enabled) {
        continue
      }

      if (statement.hasAnyError()) {
        // *** mark org as not valid?
        continue
      }

      // *** skip macro body lines ***

      this.currentLine = line
      if (this.currentPC >= 0) {
        line.address = this.currentPC
        if (statement instanceof GenericStatement) {
          if (!statement.labelExp) {
            line.address = undefined
          }
        }
      }
      line.size = statement.pass1(this)
      if (line.size === undefined) {
        // *** mark org as not valid?
      } else if (line.size == 0) {
        line.address = undefined
      } else if (this.currentPC >= 0) {
        this.currentPC += line.size
      }
    }

    // pass 2

    for (let line of lineRecords) {

      const statement = line.statement
      if (!statement || !statement.enabled || statement.hasAnyError()) {
        continue
      }

      // *** skip macro body lines ***

      this.currentLine = line
      this.currentPC = line.address ?? -1
      // always create an array so statement doesn't have to check for undefined
      // *** maybe statement.pass2 shouldn't be called if line.size undefined???
      line.bytes = new Array(line.size ?? 0).fill(undefined)
      statement.pass2(this, line.bytes)
      // throw away array if size was undefined
      if (line.size === undefined) {
        line.bytes = undefined
      }
      // *** maybe remove line.size once line.bytes is present ***
    }
  }
}

//------------------------------------------------------------------------------
