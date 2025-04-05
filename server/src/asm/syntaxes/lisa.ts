
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

  public caseSensitiveSymbols = false
  public symbolTokenPrefixes = "."
  public symbolTokenContents = ""
  public cheapLocalPrefixes = ""
  public zoneLocalPrefixes = ""
  public anonLocalChars = ""
  public namedParamPrefixes = ""
  public keywordPrefixes = ""
  public keywordsInColumn1 = false
  public macroInvokePrefixes = ""
  public macroInvokeDelimiters = ""
  public allowLabelTrailingColon = false
  public allowIndentedAssignment = false
  public allowLineContinuation = false
  public stringEscapeChars = ""
  public scopeSeparator = ""
  public defaultOrg = 0x0800

  constructor() {
    super()

    this.keywordMap = new Map<string, KeywordDef>([

      // equates
      [ "equ",  { create: () => { return new stm.EquStatement() },
                  label:  "<symbol>",
                  params: "<expression>",
                  desc:   "Equate to address or value" } ],
      [ "=",    { alias: "equ" }],
      [ "epz",  { create: () => { return new stm.EquStatement() },
                  label:  "<symbol>",
                  params: "<expression>",
                  desc:   "Equate to page zero" } ],
      [ "let",  { // TODO
                  label:  "<symbol>",
                  params: "<expression>",
                  desc:   "Label reassignment" } ],

      // pc
      [ "org",  { create: () => { return new stm.OrgStatement() },
                  params: "<expression>",
                  desc:   "Program origin" } ],
      [ "obj",  { // TODO
                  params: "<expression>",
                  desc:   "Object code address" } ],
      [ "phs",  { // TODO
                  params: "<expression>",
                  desc:   "Phase" } ],
      [ "dph",  { // TODO
                  params: "",
                  desc:   "Dephase" } ],

      // disk
      [ "icl",  { create: () => { return new stm.IncludeStatement() },
                  params: "<filename>",
                  desc:   "Include text file" } ],
      // TODO: this is used by Bilestoad but is not in docs
      [ "sav",  { create: () => { return new stm.SaveStatement() },
                  params: "<filename>",
                  desc:   "" } ],
      [ "dcm",  { // TODO
                  params: "<string>",
                  desc:   "Disk command" } ],

      // data storage
      [ "dfs",  { create: () => { return new stm.StorageStatement(1) },
                  params: "<count>[, <fill>]",
                  desc:   "Define storage" } ],
      [ ".da",  { create: () => { return new stm.DataStatement_U8() },
                  params: "<expression>[, <expression> ...]",
                  desc:   "Define storage" } ],

      [ "adr",  { create: () => { return new stm.DataStatement_U16() },
                  params: "<expression>[, <expression> ...]",
                  desc:   "Address storage" } ],

      [ "hby",  { // TODO
                  params: "<expression>[, <expression> ...]",
                  desc:   "High byte data" } ],

      [ "byt",  { // TODO
                  params: "<expression>[, <expression> ...]",
                  desc:   "Low byte data" } ],

      [ "dby",  { // TODO
                  params: "<expression>[, <expression> ...]",
                  desc:   "Double byte data" } ],

      [ "hex",  { create: () => { return new stm.HexStatement() },
                  params: "<hex>",
                  desc:   "Hexadecimal string definition" } ],

      // text
      [ "asc",  { // TODO
                  params: "<string>",
                  desc:   "ASCII string definition" } ],
      [ "str",  { // TODO
                  params: "<string>",
                  desc:   "Character string definition" } ],
      [ "dci",  { // TODO
                  params: "<string>",
                  desc:   "Define characters immediate" } ],
      [ "inv",  { // TODO
                  params: "<string>",
                  desc:   "Define inverted characters" } ],
      [ "blk",  { // TODO
                  params: "<string>",
                  desc:   "Define blinking characters" } ],

      // conditionals
      [ ".if",  { create: () => { return new stm.IfStatement() },
                  params: "<condition>",
                  desc:   "Compile if condition is true" } ],
      [ ".el",  { create: () => { return new stm.ElseStatement() },
                  params: "",
                  desc:   "Compile if previous conditions were not met" } ],
      [ ".fi",  { create: () => { return new stm.EndIfStatement() },
                  params: "",
                  desc:   "End of conditional compilation" } ],

      // misc
      [ "lst",  { // TODO
                  params: "",
                  desc:   "Listing option on" } ],
      [ "nls",  { // TODO
                  params: "",
                  desc:   "No listing/listing option off" } ],
      [ "pag",  { // TODO
                  params: "",
                  desc:   "Page eject" } ],
      [ "ttl",  { // TODO
                  params: "<string>",
                  desc:   "Title" } ],
      [ "gen",  { // TODO
                  params: "",
                  desc:   "Generate code listing" } ],
      [ "nog",  { // TODO
                  params: "",
                  desc:   "No generate code listing" } ],
      [ "pau",  { // TODO
                  params: "",
                  desc:   "Pause/force error" } ],
      [ "usr",  { // TODO
                  params: "<expression>",
                  desc:   "User defined pseudo opcode" } ],
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
