
import { SyntaxDef, KeywordDef, OpDef, Op } from "./syntax_types"
import * as stm from "../statements"

//------------------------------------------------------------------------------
// LISA 2.5
//------------------------------------------------------------------------------
//  Precedence:
//    https://archive.org/details/LISAAssemblerVersion2.5ManualPhotocopySource/page/n9
//
//    Evaluated from RIGHT TO LEFT(!), parenthesis are not allowed
//------------------------------------------------------------------------------
/*
  NOTE: '!' is the optional prefix for decimal numbers.
      Negative numbers must have it ("!-2", for example)
*/

export class LisaSyntax extends SyntaxDef {

  public symbolTokenPrefixes = "."
  public symbolTokenContents = ""
  public cheapLocalPrefixes = ""
  public zoneLocalPrefixes = ""
  public keywordsInColumn1 = false
  public macroDefineWithLabel = false
  public macroDefineParams = false
  public macroInvokePrefixes = ""
  public macroInvokeDelimiters = ""

  constructor() {
    super()

    this.keywordMap = new Map<string, KeywordDef>([

      // equates
      [ "equ",  { create: () => { return new stm.EquStatement() }}],
      [ "=",    { alias: "equ" }],
      [ "epz",  { create: () => { return new stm.EquStatement() }}],

      // pc
      [ "org",  { create: () => { return new stm.OrgStatement() }}],

      // disk
      [ "icl",  { create: () => { return new stm.IncludeStatement() }}],
      [ "sav",  { create: () => { return new stm.SaveStatement() }}],

      // data storage
      [ "dfs",  { create: () => { return new stm.StorageStatement(1) }}],
      [ ".da",  { create: () => { return new stm.DataStatement_U8() }}],
      [ "hex",  { create: () => { return new stm.HexStatement() }}],

      [ "str",  {}],
      [ "lst",  {}],
      [ "obj",  {}],
      [ "dcm",  {}],
      [ "nls",  {}],
      [ "adr",  {}],

      // conditionals
      [ ".if",  { create: () => { return new stm.IfStatement() }}],
      [ ".el",  { create: () => { return new stm.ElseStatement() }}],
      [ ".fi",  { create: () => { return new stm.EndIfStatement() }}],
      [ "end",  {}],
    ])

    this.unaryOpMap = new Map<string, OpDef>([
      // TODO: no unary negate?
      // NOTE: "/" handled directly in OpStatement parsing
    ])

    this.binaryOpMap = new Map<string, OpDef>([
      [ "*",   { pre: 10, op: Op.Mul,      ra: true }],
      [ "/",   { pre: 10, op: Op.IDiv,     ra: true }],
      [ "+",   { pre: 10, op: Op.Add,      ra: true }],
      [ "-",   { pre: 10, op: Op.Sub,      ra: true }],
      [ "=",   { pre: 10, op: Op.EQ,       ra: true }],
      [ "#",   { pre: 10, op: Op.NE,       ra: true }],
      // NOTE: docs say "Logical AND", etc. but probably mean Bitwise
      [ "&",   { pre: 10, op: Op.BitAnd,   ra: true }],
      [ "^",   { pre: 10, op: Op.BitXor,   ra: true }],
      [ "|",   { pre: 10, op: Op.BitOr,    ra: true }]
    ])
  }
}

//------------------------------------------------------------------------------
