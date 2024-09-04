
import { SyntaxDef, KeywordDef, OpDef, Op } from "./syntax_types"
import * as stm from "../statements"

//------------------------------------------------------------------------------
// ACME
//------------------------------------------------------------------------------
//  Precedence:
//    https://github.com/meonwax/acme/blob/master/docs/QuickRef.txt
//    (Section: The maths parser)
//------------------------------------------------------------------------------

// TODO: support all the ACME alias (!h for !hex, etc.)

export class AcmeSyntax extends SyntaxDef {

  public symbolTokenPrefixes = "!@."
  public symbolTokenContents = "."
  public cheapLocalPrefixes = "@"
  public zoneLocalPrefixes = "."
  public keywordsInColumn1 = true
  public macroDefineWithLabel = false  // mac <name> [<params>]
  public macroDefineParams = true
  public macroInvokePrefixes = "+"
  public macroInvokeDelimiters = ","

  constructor() {
    super()

    this.keywordMap = new Map<string, KeywordDef>([
      [ "!cpu",       { create: () => { return new stm.CpuStatement() }}],

      // equates
      [ "=",          { create: () => { return new stm.EquStatement() }}],
      [ "!set",       { create: () => { return new stm.VarAssignStatement() }}],

      // pc
      [ "*",          { create: () => { return new stm.OrgStatement() }}],
      [ "!pseudopc",  { create: () => { return new stm.PseudoPcStatement() }}],

      // disk
      [ "!source",    { create: () => { return new stm.IncludeStatement() }}],
      [ "!src",       { alias: "!source" }],
      [ "!to",        { create: () => { return new stm.DiskStatement() }}],
      [ "!binary",    { create: () => { return new stm.IncBinStatement() }}],
      [ "!bin",       { alias: "!binary" }],

      // macros
      [ "!macro",     { create: () => { return new stm.MacroDefStatement() }}],
      [ "!mac",       { alias: "!macro" }],

      // data storage
      // [ "!byte",      { create: () => { return new stm.DataStatement_X8() }}],
      // [ "!by",        { alias: "!byte" }],
      // [ "!word",      { create: () => { return new stm.DataStatement_X16() }}],
      [ "!hex",       { create: () => { return new stm.HexStatement() }}],
      [ "!align",     { create: () => { return new stm.AlignStatement() }}],
      [ "!fill",      { create: () => { return new stm.StorageStatement(1) }}],

      // text
      [ "!pet",       { create: () => { return new stm.TextStatement() }}],
      [ "!raw",       { create: () => { return new stm.TextStatement() }}],
      [ "!scr",       { create: () => { return new stm.TextStatement() }}],
      [ "!text",      { create: () => { return new stm.TextStatement() }}],
      [ "!convtab",   {}],

      // conditionals
      [ "!if",        { create: () => { return new stm.IfStatement() }}],
      [ "!ifdef",     { create: () => { return new stm.IfDefStatement(true) }}],
      [ "!ifndef",    { create: () => { return new stm.IfDefStatement(false) }}],

      // looping
      [ "!for",       { create: () => { return new stm.RepeatStatement() }}],
      [ "!do",        {}],

      // scope
      [ "!zone",      { create: () => { return new stm.ZoneStatement() }}],
      [ "!zn",        { alias: "!zone" }],

      // messages
      [ "!serious",   {}],
    ])

    /*
      14     sin(v)      Trigonometric sine function
      14     cos(v)      Trigonometric cosine function
      14     tan(v)      Trigonometric tangent function
      14     arcsin(v)   Inverse of sin()
      14     arccos(v)   Inverse of cos()
      14     arctan(v)   Inverse of tan()
      14     address(v)  Mark as address           addr(v)
      14     int(v)      Convert to integer
      14     float(v)    Convert to float
    */

    this.unaryOpMap = new Map<string, OpDef>([
      [ "!",   { pre: 13, op: Op.LogNot   }], // Complement of
      [ "NOT", { pre: 13, op: Op.LogNot   }], // Complement of
      [ "-",   { pre: 11, op: Op.Neg      }], // Negate
      [ "<",   { pre:  7, op: Op.LowByte  }], // Lowbyte of
      [ ">",   { pre:  7, op: Op.HighByte }], // Highbyte of
      [ "^",   { pre:  7, op: Op.BankByte }], // Bankbyte of

      [ "(",   { pre: 0,  op: Op.Group, end: ")" }]
    ])

    this.binaryOpMap = new Map<string, OpDef>([
      [ "^",   { pre: 12, op: Op.Pow      }], // To the power of
      [ "*",   { pre: 10, op: Op.Mul      }], // Multiply
      [ "/",   { pre: 10, op: Op.FDiv     }], // Divide (floating point!)
      [ "DIV", { pre: 10, op: Op.IDiv     }], // Integer-Divide
      [ "%",   { pre: 10, op: Op.Mod      }], // Remainder of DIV
      [ "MOD", { pre: 10, op: Op.Mod      }], // Remainder of DIV
      [ "+",   { pre:  9, op: Op.Add      }], // Add
      [ "-",   { pre:  9, op: Op.Sub      }], // Subtract
      [ "<<",  { pre:  8, op: Op.ASL      }], // Shift left
      [ "ASL", { pre:  8, op: Op.ASL      }], // Shift left
      [ "LSL", { pre:  8, op: Op.ASL      }], // Shift left
      [ ">>",  { pre:  8, op: Op.ASR      }], // Arithmetic shift right
      [ "ASR", { pre:  8, op: Op.ASR      }], // Arithmetic shift right
      [ ">>>", { pre:  8, op: Op.LSR      }], // Logical shift right
      [ "LSR", { pre:  8, op: Op.LSR      }], // Logical shift right
      [ "<=",  { pre:  6, op: Op.LE       }], // Lower or equal
      [ "<",   { pre:  6, op: Op.LT       }], // Lower than
      [ ">=",  { pre:  6, op: Op.GE       }], // Higher or equal
      [ ">",   { pre:  6, op: Op.GT       }], // Higher than
      [ "!=",  { pre:  5, op: Op.NE       }], // Not equal
      [ "<>",  { pre:  5, op: Op.NE       }], // Not equal
      [ "><",  { pre:  5, op: Op.NE       }], // Not equal
      [ "=",   { pre:  4, op: Op.EQ       }], // Equal
      [ "&",   { pre:  3, op: Op.BitAnd   }], // Bit-wise AND
      [ "AND", { pre:  3, op: Op.BitAnd   }], // Bit-wise AND
      [ "XOR", { pre:  2, op: Op.BitXor   }], // Bit-wise XOR
      [ "|",   { pre:  1, op: Op.BitOr    }], // Bit-wise OR
      [ "OR",  { pre:  1, op: Op.BitOr    }], // Bit-wise OR
    ])
  }
}

//------------------------------------------------------------------------------
