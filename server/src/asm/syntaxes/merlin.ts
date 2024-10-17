
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
  public anonLocalChars = ""
  public namedParamPrefixes = ""
  public keywordPrefixes = ""
  public keywordsInColumn1 = false
  public macroInvokePrefixes = ""
  public macroInvokeDelimiters = ";"
  public allowLabelTrailingColon = false
  public allowIndentedAssignment = false
  public allowLineContinuation = false
  public allowStringEscapes = false
  public scopeSeparator = ""
  public defaultOrg = 0x8000        // TODO: check this value

  constructor() {
    super()

    this.keywordMap = new Map<string, KeywordDef>([
      // target
      [ "xc",     { create: () => { return new stm.CpuStatement() },
                    params: "",
                    desc:   "Extended 65C02, 65802 and 65816 opCodes" } ],

      // equates
      [ "equ",    { create: () => { return new stm.EquStatement() },
                    label:  "<symbol>",
                    params: "<expresion>",
                    desc:   "Assign symbol value" } ],
      [ "=",      { alias:  "equ" }],
      [ "var",    { // TODO
                    params: "<expression>[; <expression> ...]",
                    desc:   "Setup variables" } ],

      // pc
      [ "org",    { create: () => { return new stm.OrgStatement() },
                    params: "[<expression>]",
                    desc:   "Set origin" } ],
      [ "dum",    { create: () => { return new stm.DummyStatement() },
                    params: "<expression>",
                    desc:   "Start of dummy section" } ],
      // NOTE: dummy not supported by merlin32 but is support by old merlin
      [ "dummy",  { alias:  "dum" }],
      [ "dend",   { create: () => { return new stm.DummyEndStatement() },
                    params: "",
                    desc:   "End of dummy section" } ],
      [ "obj",    { // TODO
                    params: "<expression>",
                    desc:   "Set object" } ],
      [ "rel",    { // TODO
                    params: "",
                    desc:   "Relocatable code module" } ],

      // disk
      [ "put",    { create: () => { return new stm.IncludeStatement() },
                    params: "<filename>[[, {s5|s6}], {d1|d2}]",
                    desc:   "Put a text file in assembly" } ],
      [ "use",    { create: () => { return new stm.IncludeStatement() },
                    params: "<filename>[[, {s5|s6}], {d1|d2}]",
                    desc:   "Use a text file as a macro library" } ],
      [ "sav",    { create: () => { return new stm.SaveStatement() },
                    // TODO: allow <slot>, <drive>?
                    params: "<filename>",
                    desc:   "Save object code" } ],
      [ "dsk",    { create: () => { return new stm.DiskStatement() },
                    // TODO: allow <slot>, <drive>?
                    params: "<filename>",
                    desc:   "Assembly directly to disk" } ],
      [ "typ",    { // TODO
                    params: "<expression>",
                    desc:   "Set ProDOSA file type for DSK and SAV" } ],

      // macros
      [ "mac",    { create: () => { return new stm.MacroDefStatement() },
                    label:  "<symbol>",
                    params: "",
                    desc:   "Start of macro definition" } ],
      [ "eom",    { create: () => { return new stm.EndMacroDefStatement() },
                    label:  "[<symbol>]",
                    params: "",
                    desc:   "End of macro definition" } ],
      [ "<<<",    { alias:  "eom" }],
      [ "pmc",    { // TODO
                    params: " <symbol> [<expression>[; <expression> ...]]",
                    desc:   "Invoke macro" } ],
      [ ">>>",    { alias:  "pmc" }],

      // data storage
      [ "dw",     { create: () => { return new stm.DataStatement_X16() },
                    params: "[#]<expression> [, [#]<expression> ...]",
                    desc:   "Define word or address (little endian)" } ],
      [ "da",     { alias:  "dw" }],
      [ "ddb",    { create: () => { return new stm.DataStatement_X16(true) },
                    params: "<expression> [, <expression> ...]",
                    desc:   "Define double byte (big endian)" } ],
      [ "db",     { create: () => { return new stm.DataStatement_X8() },
                    params: "[#]<expression> [, [#]<expression> ...]",
                    desc:   "Define byte" } ],
      [ "dfb",    { alias:  "db" }],
      [ "adr",    { create: () => { return new stm.DataStatement_U24() },
                    params: "<expression> [, <expression> ...]",
                    desc:   "Define long address - 3 bytes" } ],
      [ "adrl",   { create: () => { return new stm.DataStatement_U32() },
                    params: "<expression> [, <expression> ...]",
                    desc:   "Define long address - 4 bytes" } ],
      [ "hex",    { create: () => { return new stm.HexStatement() },
                    params: "<hex>[, <hex> ...]",
                    desc:   "Define hex data" } ],
      [ "ds",     { create: () => { return new stm.StorageStatement(1) },
                    params: "{\\\\|<count>}[, <fill>]",
                    desc:   "Define storage" } ],

      // text
      [ "asc",    { create: () => { return new stm.TextStatement() },
                    params: "<string>[, <hex>]",
                    desc:   "Define ascii text" } ],
      [ "dci",    { create: () => { return new stm.TextStatement() },
                    params: "<string>[, <hex>]",
                    desc:   "Define dextral character inverted text" } ],
      [ "inv",    { create: () => { return new stm.TextStatement() },
                    params: "<string>[, <hex>]",
                    desc:   "Define inverse text" } ],
      [ "fls",    { create: () => { return new stm.TextStatement() },
                    params: "<string>[, <hex>]",
                    desc:   "Define flashing text" } ],
      [ "rev",    { create: () => { return new stm.TextStatement() },
                    params: "<string>[, <hex>]",
                    desc:   "Define reversed text" } ],
      [ "str",    { create: () => { return new stm.TextStatement() },
                    params: "<string>[, <hex>]",
                    desc:   "Define string with leading length byte" } ],

      // conditionals
      [ "do",     { create: () => { return new stm.IfStatement() },
                    params: "<condition>",
                    desc:   "Compile if condition is true" } ],
      [ "if",     { // TODO
                    params: "<char>[, <var>]",
                    desc:   "If so then do" } ],
      [ "else",   { create: () => { return new stm.ElseStatement() },
                    params: "",
                    desc:   "Compile if previous conditions were not met" } ],
      [ "fin",    { create: () => { return new stm.EndIfStatement() },
                    params: "",
                    desc:   "End of conditional compilation" } ],

      [ "end",    { // TODO
                    params: "",
                    desc:   "End of a source file" } ],

      [ "lup",    { create: () => { return new stm.RepeatStatement() },
                    params: "<expression>",
                    desc:   "Start of loop" } ],
      [ "--^",    { create: () => { return new stm.EndRepStatement() },
                    params: "",
                    desc:   "End of loop" } ],

      // formatting
      [ "tr",     { create: () => { return new stm.ListStatement() },
                    params: "{on|off|adr}",
                    desc:   "Truncate control" } ],
      [ "lst",    { create: () => { return new stm.ListStatement() },
                    params: "[{on|off|rtn}]",
                    desc:   "Listing control" } ],
      [ "lstdo",  { create: () => { return new stm.ListStatement() },
                    params: "[{off}]",
                    desc:   "List DO OFF areas of code" } ],
      [ "exp",    { create: () => { return new stm.ListStatement() },
                    params: "{on|off|only}",
                    desc:   "Macro expand control" } ],
      [ "pag",    { create: () => { return new stm.ListStatement() },
                    params: "",
                    desc:   "New page" } ],
      [ "page",   { alias:  "pag" } ],
      [ "ast",    { // TODO:
                    params: "<expression>",
                    desc:   "Send a line of asterisks" } ],
      [ "cyc",    { // TODO:
                    params: "[{off|avg|flags}]",
                    desc:   "Calculate and print cycle times for code" } ],
      [ "dat",    { // TODO:
                    params: "",
                    desc:   "Date stamp assembly listing (ProDOS only)" } ],
      [ "ttl",    { // TODO:
                    params: "<string>",
                    desc:   "Define title heading (Merlin 16 only)" } ],
      [ "skp",    { // TODO:
                    params: "<expression>",
                    desc:   "Skip lines" } ],

      // import/export
      [ "ent",    { create: () => { return new stm.EntryStatement() },
                    label: "<symbol>",
                    params: "",
                    desc:   "Export entry point label" } ],
      [ "ext",    { // TODO
                    label: "<symbol>",
                    params: "",
                    desc:   "Import external label" } ],

      // misc
      [ "err",    { create: () => { return new stm.AssertFalseStatement("error") },
                    params: "<condition>",
                    desc:   "Force an error" } ],
      [ "chk",    { // TODO
                    params: "",
                    desc:   "Place checksum in object code" } ],
      [ "kbd",    { // TODO
                    label: "<symbol>",
                    params: "[<string>]",
                    desc:   "Define from keyboard" } ],
      [ "mx",     { // TODO
                    params: "<expression>",
                    desc:   "Long status mode of 65802" } ],
      [ "pau",    { // TODO
                    params: "",
                    desc:   "Pause" } ],
      [ "sw",     { // TODO
                    params: "",
                    desc:   "Sweet 16 opcodes (Merlin 8 only)" } ],

      [ "usr",    { create: () => { return new stm.UsrStatement() },
                    params: "[<expression> [, <expression>]]",
                    desc:   "User definable opcode" } ],

      // text
      // TODO: eventually treat these as macros
      [ "txt",    { create: () => { return new stm.TextStatement() },
                    params: "<string>",
                    desc:   "Define naja-format text, terminated with $8D" } ],
      [ "txc",    { create: () => { return new stm.TextStatement() },
                    params: "<string>",
                    desc:   "Define continued naja-format text, without termination" } ],
      [ "txi",    { create: () => { return new stm.TextStatement() },
                    params: "<string>",
                    desc:   "Define naja-format text, terminated with inverted high bit" } ],
    ])

    this.unaryOpMap = new Map<string, OpDef>([
      [ "-",   { pre: 10, op: Op.Neg      }],

      // TODO: should these be included?
      // NOTE: These are lower precedence than other operators
      //  so that they are applied last in "LDA #<ADDR+$100", for example.
      [ "<",   { pre:  9, op: Op.LowByte  }],
      [ ">",   { pre:  9, op: Op.HighByte }],
      [ "^",   { pre:  9, op: Op.BankByte }]
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
