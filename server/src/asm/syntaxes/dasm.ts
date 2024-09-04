
import { SyntaxDef, KeywordDef, OpDef, Op } from "./syntax_types"
import * as stm from "../statements"

//------------------------------------------------------------------------------
// DASM
//------------------------------------------------------------------------------
//  Precedence:
//    https://github.com/dasm-assembler/dasm/blob/master/docs/dasm.pdf
//    Page 24, 25
//
//  All directives (and incidentally also the mnemonics) can be prefixed with
//  a dot "." or a crosshatch "#" for compatibility with other assemblers. So,
//  ".IF" is the same as "IF" and "#IF".
//
//------------------------------------------------------------------------------

export class DasmSyntax extends SyntaxDef {

  public symbolTokenPrefixes = ".#"
  public symbolTokenContents = "."
  public cheapLocalPrefixes = ""
  public zoneLocalPrefixes = "."
  public keywordsInColumn1 = true
  public macroDefineWithLabel = false  // mac <name> [<params>]
  public macroDefineParams = false
  public macroInvokePrefixes = ""
  public macroInvokeDelimiters = ","

  constructor() {
    super()

    this.keywordMap = new Map<string, KeywordDef>([
      [ "processor",  { create: () => { return new stm.CpuStatement() }}],
      [ "err",        { create: () => { return new stm.ErrorStatement() }}],

      // equates
      [ "equ",        { create: () => { return new stm.EquStatement() }}],
      [ "=",          { alias: "equ" }],
      [ "set",        { create: () => { return new stm.VarAssignStatement() }}],

      // pc
      [ "org",        { create: () => { return new stm.OrgStatement() }}],

      // disk
      [ "include",    { create: () => { return new stm.IncludeStatement() }}],
      [ "incdir",     { create: () => { return new stm.IncDirStatement() }}],
      [ "incbin",     { create: () => { return new stm.IncBinStatement() }}],

      // macros
      [ "macro",      { create: () => { return new stm.MacroDefStatement() }}],
      [ "mac",        { alias: "macro" }],
      [ "endm",       { create: () => { return new stm.EndMacroDefStatement() }}],
      [ "mexit",      {}],

      // segments
      [ "seg",        { create: () => { return new stm.SegmentStatement() }}],
      [ "seg.u",      { create: () => { return new stm.SegmentStatement() }}],

      [ "echo",       {}],

      // data storage
      [ "ds",         { create: () => { return new stm.StorageStatement(1) }}],
      [ "ds.b",       { create: () => { return new stm.StorageStatement(1) }}],
      [ "ds.w",       { create: () => { return new stm.StorageStatement(2) }}],
      [ "ds.s",       { create: () => { return new stm.StorageStatement(2, true) }}],
      // [ "dc",         { create: () => { return new stm.DataStatement_X8() }}],
      // [ "dc.b",       { create: () => { return new stm.DataStatement_X8() }}],
      // [ "dc.w",       { create: () => { return new stm.DataStatement_X16() }}],
      // [ "dc.l",       { create: () => { return new stm.DataStatement_U32() }}],
      // [ "dc.s",       { create: () => { return new stm.DataStatement_X16(true) }}],
      [ "byte",       { alias: "dc.b" }],
      [ "word",       { alias: "dc.w" }],
      [ "hex",        { create: () => { return new stm.HexStatement() }}],
      [ "align",      { create: () => { return new stm.AlignStatement() }}],

      // conditionals
      [ "if",         { create: () => { return new stm.IfStatement() }}],
      [ "ifconst",    { create: () => { return new stm.IfDefStatement(true) }}],
      [ "ifnconst",   { create: () => { return new stm.IfDefStatement(false) }}],
      [ "else",       { create: () => { return new stm.ElseStatement() }}],
      [ "elif",       { create: () => { return new stm.ElseIfStatement() }}],
      [ "endif",      { create: () => { return new stm.EndIfStatement() }}],
      [ "eif",        { alias: "endif" }],
      [ "end",        {}],

      // looping
      [ "repeat",     { create: () => { return new stm.RepeatStatement() }}],
      [ "repend",     { create: () => { return new stm.EndRepStatement() }}],

      // scope
      [ "subroutine", { create: () => { return new stm.SubroutineStatement() }}],

      [ "list",       { create: () => { return new stm.ListStatement() }}]
    ])

    this.unaryOpMap = new Map<string, OpDef>([
      [ "~",   { pre: 20, op: Op.BitNot   }], // bitwise NOT
      [ "-",   { pre: 20, op: Op.Neg      }], // negation
      [ "!",   { pre: 20, op: Op.LogNot   }], // logical NOT
      [ "<",   { pre: 20, op: Op.LowByte  }], // low-byte
      [ ">",   { pre: 20, op: Op.HighByte }], // high-byte

      [ "(",   { pre: 0,  op: Op.Group, end: ")" }],
      [ "{",   { pre: 0,  op: Op.Group, end: "}" }]
    ])

    this.binaryOpMap = new Map<string, OpDef>([
      [ "*",   { pre: 19, op: Op.Mul      }], // Multiplication
      [ "/",   { pre: 19, op: Op.IDiv     }], // Division (integer)
      [ "%",   { pre: 19, op: Op.Mod      }], // Modulus
      [ "+",   { pre: 18, op: Op.Add      }], // Addition
      [ "-",   { pre: 18, op: Op.Sub      }], // Subtraction
      [ ">>",  { pre: 17, op: Op.ASR      }], // Arithmetic shift right
      [ "<<",  { pre: 17, op: Op.ASL      }], // Arithmetic shift left
      [ ">",   { pre: 16, op: Op.GT       }], // Greater than
      [ ">=",  { pre: 16, op: Op.GE       }], // Greater than or equal to
      [ "<",   { pre: 16, op: Op.LT       }], // Less than
      [ "<=",  { pre: 16, op: Op.LE       }], // Less than or equal to
      [ "==",  { pre: 15, op: Op.EQ       }], // Logical equal to.
      [ "=",   { pre: 15, op: Op.EQ       }], // Logical equal to. Deprecated! (use ‘==’)
      [ "!=",  { pre: 15, op: Op.NE       }], // Not equal to
      [ "&",   { pre: 14, op: Op.BitAnd   }], // Arithmetic AND
      [ "^",   { pre: 13, op: Op.BitXor   }], // Arithmetic XOR
      [ "|",   { pre: 12, op: Op.BitOr    }], // Arithmetic OR
      [ "&&",  { pre: 11, op: Op.LogAnd   }], // Logical AND. Evaluates as 0 or 1
      [ "||",  { pre: 10, op: Op.LogOr    }], // Logical OR. Evaluates as 0 or 1
    ])

    /*
      9      ?           If the left expression is TRUE, result is the right
                          expression, else result is 0. [10?20] returns 20.
                          The function of the C conditional operator a?b:c
                          can be achieved by using [a?b-c]+c.
                          expression, else result is 0. [10?20] returns 20.
                          The function of the C conditional operator a?b:c
                          can be achieved by using [a?b-c]+c.
      8      [ ]         Group expressions (used in place of parenthesis)
      7      ,           Separates expressions in list (also used in
                          addressing mode resolution, so be careful!)

      "It is possible to use round brackets () instead of square brackets [] in
      expressions following directives, but not following mnemonics.
      Use square brackets [] when you are unsure."
    */
  }
}

//------------------------------------------------------------------------------
