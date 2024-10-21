
import { SyntaxDef, KeywordDef, OpDef, Op } from "./syntax_types"
import * as stm from "../statements"

//------------------------------------------------------------------------------
// ACME
//------------------------------------------------------------------------------
//  Precedence:
//    https://github.com/meonwax/acme/blob/master/docs/QuickRef.txt
//    (Section: The maths parser)
//------------------------------------------------------------------------------

export class AcmeSyntax extends SyntaxDef {

  public symbolTokenPrefixes = "!@."
  public symbolTokenContents = "."
  public cheapLocalPrefixes = "@"
  public zoneLocalPrefixes = "."
  public anonLocalChars = "+-"
  public namedParamPrefixes = ""
  public keywordPrefixes = "!"
  public keywordsInColumn1 = true
  public macroInvokePrefixes = "+"
  public macroInvokeDelimiters = ","
  public allowLabelTrailingColon = true
  public allowIndentedAssignment = true
  public allowLineContinuation = false
  public stringEscapeChars = "\\'\"0tnr"
  public scopeSeparator = ""
  public defaultOrg = 0x0800        // TODO: choose correct value

  constructor() {
    super()

    // *** TODO: filenames can be "" or <> quoted ***

    this.keywordMap = new Map<string, KeywordDef>([
      [ "!cpu",       { create: () => { return new stm.CpuStatement() },
                        params: "{6502|6510|65c02|65816} [ \\{ [<block> \\} ]]",
                        desc:   "Select the processor to produce code for" } ],

      // equates
      [ "=",          { create: () => { return new stm.EquStatement() },
                        label:  "<symbol>",
                        params: "<expression>",
                        desc:   "Assign value to symbol" } ],
      [ "!set",       { create: () => { return new stm.VarAssignStatement() },
                        params: "<symbol> = <value>",
                        desc:   "Assign given value to symbol even if the symbol already has a different value" } ],
      [ "!address",   { create: () => { return new stm.AddressStatement() },
                        params: "{\\{ [<block> \\}] | <symbol-def> = <value>}",
                        desc:   'Mark a block or a statement as "explicitly defined symbols are holding addresses"' } ],
      [ "!addr",      { alias: "!address" }],

      // pc
      [ "*",          { create: () => { return new stm.OrgStatement() },
                        params: "= <expression>[, {overlay|invisible} ...]",
                        desc:   "Set program counter to given value and start new segment" } ],
      [ "!pseudopc",  { create: () => { return new stm.PseudoPcStatement() },
                        params: "<expression> \\{ [<block> \\}]",
                        desc:   "Assemble code as if the program counter had the given value" } ],

      // disk
      [ "!source",    { create: () => { return new stm.IncludeStatement() },
                        params: "<filename>",
                        desc:   "Assemble another source code file" } ],
      [ "!src",       { alias: "!source" }],
      [ "!to",        { create: () => { return new stm.DiskStatement() },
                        params: "<filename>[,{cbm|plain|apple}]",
                        desc:   "Define the output file name and file type" } ],
      [ "!binary",    { create: () => { return new stm.IncBinStatement() },
                        params: "<filename>[, [<size>] [, <offset>]]",
                        desc:   "Insert binary file directly into output file" } ],
      [ "!bin",       { alias: "!binary" }],

      // macros
      [ "!macro",     { create: () => { return new stm.MacroDefStatement() },
                        label:  "",
                        params: "<type-name> [ [~]<type-param> [, [~]<type-param> ...] ] \\{ [<block> \\}]",
                        desc:   "Define a macro" } ],

      // data storage
      [ "!byte",      { create: () => { return new stm.DataStatement_X8() },
                        params: "<expression>[, <expression> ...]",
                        desc:   "Insert 8-bit values" } ],
      [ "!by",        { alias: "!byte" }],
      [ "!08",        { alias: "!byte" }],
      [ "!8",         { alias: "!byte" }],
      [ "!word",      { create: () => { return new stm.DataStatement_X16() },
                        params: "<expression>[, <expression> ...]",
                        desc:   "Insert 16-bit values in little endian byte order" } ],
      [ "!wo",        { alias: "!word" }],
      [ "!16",        { alias: "!word" }],
      [ "!le16",      { alias: "!word" }],
      [ "!be16",      { create: () => { return new stm.DataStatement_X16(true) },
                        params: "<expression>[, <expression> ...]",
                        desc:   "Insert 16-bit values in big endian byte order" } ],
      [ "!24",        { create: () => { return new stm.DataStatement_X24() },
                        params: "<expression>[, <expression> ...]",
                        desc:   "Insert 24-bit values in little endian byte order" } ],
      [ "!le24",      { alias: "!24" }],
      [ "!be24",      { create: () => { return new stm.DataStatement_X24(true) },
                        params: "<expression>[, <expression> ...]",
                        desc:   "Insert 24-bit values in big endian byte order" } ],
      [ "!32",        { create: () => { return new stm.DataStatement_X32() },
                        params: "<expression>[, <expression> ...]",
                        desc:   "Insert 32-bit values in little endian byte order" } ],
      [ "!le32",      { alias: "!32" }],
      [ "!be32",      { create: () => { return new stm.DataStatement_X32(true) },
                        params: "<expression>[, <expression> ...]",
                        desc:   "Insert 32-bit values in big endian byte order" } ],
      [ "!hex",       { create: () => { return new stm.HexStatement() },
                        params: "<hex>[ <hex> ...]",
                        desc:   "Insert byte values with a minimum of additional syntax" } ],
      [ "!h",         { alias: "!hex" }],
      [ "!align",     { create: () => { return new stm.AlignStatement() },
                        params: "<and>, <equal>[, <fill>]",
                        desc:   "Fill memory until a matching address is reached" } ],
      [ "!fill",      { create: () => { return new stm.StorageStatement(1) },
                        params: "<count>[, <fill>]",
                        desc:   "Fill amount of memory with value" } ],
      [ "!fi",        { alias: "!fill" }],
      [ "!skip",      { // TODO
                        params: "<amount>",
                        desc:   "Advance in output buffer without starting a new segment" } ],
      [ "!initmem",   { // TODO
                        params: "<expression>",
                        desc:   'Define "unchanged" memory' } ],
      [ "!xor",       { create: () => { return new stm.XorStatement() },
                        params: "<expression> [\\{ [<block> \\}]]",
                        desc:   "Change the value to XOR all output bytes" } ],

      // text
      [ "!pet",       { create: () => { return new stm.TextStatement() },
                        params: "<string-value>[, <string-value> ...]",
                        desc:   "Output the given string(s) using PetSCII" } ],
      [ "!raw",       { create: () => { return new stm.TextStatement() },
                        params: "<string-value>[, <string-value> ...]",
                        desc:   "Output the given string(s) without any conversion" } ],
      [ "!scr",       { create: () => { return new stm.TextStatement() },
                        params: "<string-value>[, <string-value> ...]",
                        desc:   "Output the given string(s) using the C64 screen code" } ],
      [ "!text",      { create: () => { return new stm.TextStatement() },
                        params: "<string-value>[, <string-value> ...]",
                        desc:   "Output the given string(s) using the current conversion table" } ],
      [ "!scrxor",    { // TODO
                        params: "<xor>, <string-value>[, <string-value> ...]",
                        desc:   "Output the given string(s) using the C64 screen code xor value" } ],
      [ "!tx",        { alias: "!text" }],
      [ "!convtab",   { create: () => { return new stm.ConvTabStatement() },
                        params: "{pet|raw|scr|<filename>} [\\{ [<block> \\}]]",
                        desc:   "Choose text conversion table" } ],
      [ "!ct",        { alias: "!convtab" }],

      // conditionals
      [ "!if",        { create: () => { return new stm.AcmeIfStatement() },
                        params: "<condition> \\{ [<block> \\} [else \\{ <block> \\}]]",
                        desc:   "If the given condition is true, parse the first block of statements" } ],
      [ "!ifdef",     { create: () => { return new stm.IfDefStatement(true) },
                        params: "<symbol-weakref> \\{ [<block> \\} [ else \\{ <block> \\} ]]",
                        desc:   "If the given symbol is defined, parse the first block of statements" } ],
      [ "!ifndef",    { create: () => { return new stm.IfDefStatement(false) },
                        params: "<symbol-weakref> \\{ [<block> \\} [ else \\{ <block> \\} ]]",
                        desc:   "If the given symbol is not defined, parse the first block of statements" } ],

      [ "!endoffile", { // TODO
                        params: "",
                        desc:   "Stop processing the current source file" } ],
      [ "!eof",       { alias: "!endoffile" }],

      // looping
      [ "!for",       { create: () => { return new stm.RepeatStatement() },
                        params: "<symbol-def>, {<start>, <end> | <end> } \\{ [<block> \\}]",
                        desc:   "Looping assembly" } ],
      [ "!do",        { // TODO
                        params: "[<condition>] \\{ [<block> \\} [<condition>]]",
                        desc:   "Looping assembly" } ],
      [ "!while",     { // TODO
                        params: "[<condition>] \\{ [<block> \\} [<condition>]]",
                        desc:   "Looping assembly" } ],

      // scope
      [ "!zone",      { create: () => { return new stm.ZoneStatement() },
                        params: "[<name:symbol-def>] [\\{ [<block> \\}]]",
                        desc:   "Switch to new zone of local symbols" } ],
      [ "!zn",        { alias: "!zone" }],
      [ "!symbollist",{ // TODO
                        params: "<filename>",
                        desc:   "Write a symbol list to the given file after assembly" } ],
      [ "!sl",        { alias: "!symbollist" }],
      // TODO: bother with "VICE label dumping?"
      [ "!svl",       { alias: "!symbollist" }],

      // messages
      [ "!warn",      { create: () => { return new stm.AssertTrueStatement("warning", true) },
                        params: "<string-value> [, <string-value> ...]",
                        desc:   "Show a warning during assembly" } ],
      [ "!error",     { create: () => { return new stm.AssertTrueStatement("error", true) },
                        params: "<string-value> [, <string-value> ...]",
                        desc:   "Generate an error during assembly" } ],
      [ "!serious",   { create: () => { return new stm.AssertTrueStatement("fatal", true) },
                        params: "<string-value> [, <string-value> ...]",
                        desc:   "Generate a serious error, immediately stopping assembly" } ],
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
