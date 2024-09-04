
import { SyntaxDef, KeywordDef, OpDef, Op } from "./syntax_types"
import * as stm from "../statements"

//------------------------------------------------------------------------------
// MERLIN
//------------------------------------------------------------------------------
//  Precedence:
//    https://archive.org/details/Merlin_816_Macro_Assembler_Manual/page/n91
//
//    Evaluated left to right, parenthesis not allowed
//------------------------------------------------------------------------------

export class MerlinSyntax extends SyntaxDef {

  public symbolTokenPrefixes = ":]"
  public symbolTokenContents = "?"    // TODO: add others (any character > ':')
  public cheapLocalPrefixes = ":"
  public zoneLocalPrefixes = ""
  public keywordsInColumn1 = false
  public macroDefineWithLabel = true   // <name> mac [<params>]
  public macroDefineParams = false
  public macroInvokePrefixes = ""
  public macroInvokeDelimiters = ";"

  constructor() {
    super()

    this.keywordMap = new Map<string, KeywordDef>([
      [ "xc",     { create: () => { return new stm.CpuStatement() }}],
      [ "err",    { create: () => { return new stm.ErrorStatement() }}],

      // equates
      [ "equ",    { create: () => { return new stm.EquStatement() }}],
      [ "=",      { alias: "equ" }],

      // pc
      [ "org",    { create: () => { return new stm.OrgStatement() }}],
      [ "dummy",  { create: () => { return new stm.DummyStatement() }}],
      [ "dum",    { alias: "dummy" }],
      [ "dend",   { create: () => { return new stm.DummyEndStatement() }}],

      // disk
      [ "put",    { create: () => { return new stm.IncludeStatement() }}],
      [ "use",    { create: () => { return new stm.IncludeStatement() }}],
      [ "sav",    { create: () => { return new stm.SaveStatement() }}],
      [ "dsk",    { create: () => { return new stm.DiskStatement() }}],

      // macros
      [ "mac",    { create: () => { return new stm.MacroDefStatement() }}],
      [ "eom",    { create: () => { return new stm.EndMacroDefStatement() }}],
      [ "<<<",    { alias: "eom" }],

      [ "usr",    { create: () => { return new stm.UsrStatement() }}],

      // data storage
      // [ "db",     { create: () => { return new stm.DataStatement_U8() }}],
      // [ "dfb",    { alias: "db" }],
      // [ "ddb",    { create: () => { return new stm.DataStatement_U16(true) }}],
      // [ "dw",     { create: () => { return new stm.DataStatement_U16() }}],
      // [ "da",     { alias: "dw" }],
      [ "ds",     { create: () => { return new stm.StorageStatement(1) }}],
      [ "hex",    { create: () => { return new stm.HexStatement() }}],

      [ "asc",    { create: () => { return new stm.TextStatement() }}],
      [ "dci",    { create: () => { return new stm.TextStatement() }}],
      [ "rev",    { create: () => { return new stm.TextStatement() }}],
      [ "str",    { create: () => { return new stm.TextStatement() }}],

      // text
      // TODO: eventually treat these as macros
      [ "txt",    { create: () => { return new stm.TextStatement() }}],
      [ "txc",    { create: () => { return new stm.TextStatement() }}],
      [ "txi",    { create: () => { return new stm.TextStatement() }}],

      // conditionals
      [ "do",     { create: () => { return new stm.IfStatement() }}],
      [ "else",   { create: () => { return new stm.ElseStatement() }}],
      [ "fin",    { create: () => { return new stm.EndIfStatement() }}],
      [ "end",    {}],

      [ "lup",    { create: () => { return new stm.RepeatStatement() }}],
      [ "--^",    { create: () => { return new stm.EndRepStatement() }}],

      [ "tr",     { create: () => { return new stm.ListStatement() }}],
      [ "lst",    { create: () => { return new stm.ListStatement() }}],
      [ "lstdo",  { create: () => { return new stm.ListStatement() }}],
      [ "exp",    { create: () => { return new stm.ListStatement() }}],
      [ "page",   { create: () => { return new stm.ListStatement() }}],
      [ "obj",    {}],

      // import/export
      [ "ent",    { create: () => { return new stm.EntryStatement() }}],
    ])

    this.unaryOpMap = new Map<string, OpDef>([
      [ "-",   { pre: 10, op: Op.Neg      }],

      // TODO: should these be included?
      [ "<",   { pre: 10, op: Op.LowByte  }],
      [ ">",   { pre: 10, op: Op.HighByte }],
      [ "^",   { pre: 10, op: Op.BankByte }]
    ])

    this.binaryOpMap = new Map<string, OpDef>([
      [ "*",   { pre: 10, op: Op.Mul      }],
      [ "/",   { pre: 10, op: Op.IDiv     }],
      [ "+",   { pre: 10, op: Op.Add      }],
      [ "-",   { pre: 10, op: Op.Sub      }],
      [ "&",   { pre: 10, op: Op.BitAnd   }],
      [ "!",   { pre: 10, op: Op.BitXor   }],
      [ ".",   { pre: 10, op: Op.BitOr    }]
    ])
  }
}

//------------------------------------------------------------------------------
