// import { Project } from "./project"
import { SourceDoc, SourceLine } from "./source_doc"
// import { Disassembler } from "./disasm"
import { IMachineMemory } from "./shared"
import { RpwSettings, RpwSettingsDefaults } from "../rpw_types"

//------------------------------------------------------------------------------

export class SourceDocBuilder {

  public static buildRawDoc(lines: string[]): SourceDoc {
    const builder = new SourceDocBuilder(RpwSettingsDefaults)
    let parser = new MerlinLstParser(builder)
    parser.parse(lines)
    return builder.sourceDocs[0]
  }

  public static buildLstDocs(settings: RpwSettings, lstFileName: string, lines: string[]): SourceDoc[] {
    const builder = new SourceDocBuilder(settings)
    return builder._buildLstDocs(lstFileName, lines)
  }

  // public static buildLstDocs(project: Project, lstFileName: string, lines: string[]): SourceDoc[] {
  //   const builder = new SourceDocBuilder(project.settings, project.machine)
  //   return builder._buildLstDocs(lstFileName, lines)
  // }

  // public static buildDis65Docs(project: Project, dis65: any, binData: Uint8Array): SourceDoc[] {
  //   const builder = new SourceDocBuilder(project.settings, project.machine)
  //   return builder._buildDis65Docs(project.name, dis65, binData)
  // }

  private startBuild() {
    this.lstFileName = ""
  }

  private settings: RpwSettings
  private memory?: IMachineMemory
  private lstFileName?: string
  private sourceDocs: SourceDoc[] = []
  public /*internal*/ currentDoc?: SourceDoc

  constructor(settings: RpwSettings, memory?: IMachineMemory) {
    this.settings = settings
    this.memory = memory
  }

  private _buildLstDocs(lstFileName: string, lines: string[]): SourceDoc[] {
    this.lstFileName = lstFileName

    if (lines[0].startsWith("ca65")) {
      let parser = new Ca65LstParser(this)
      parser.parse(lines)
    } else if (lines[0].indexOf("------- FILE ") == 0) {
      let parser = new DasmLstParser(this)
      parser.parse(lines)
    } else {
      let parser = new MerlinLstParser(this)
      parser.parse(lines)
    }

    // trim documents that don't have any actual code in them
    // TODO: should this be optional?
    this.sourceDocs = this.sourceDocs.filter((sourceDoc: SourceDoc) => {
      let removeDoc = true
      for (let i = 0; i < sourceDoc.sourceLines.length; i += 1) {
        if (sourceDoc.sourceLines[i].address != -1) {
          removeDoc = false
          break
        }
      }
      return !removeDoc
    })

    for (let sourceDoc of this.sourceDocs) {
      // build final Uint8Array for each document
      sourceDoc.objBuffer = Uint8Array.from(sourceDoc.objData!)
      delete sourceDoc.objData
      // remove fileLine property and initialize line number index
      // remove objData array and replace with final objBuffer Uint8Array
      for (let sourceLine of sourceDoc.sourceLines) {
        delete sourceLine.fileLine
        sourceLine.objBuffer = sourceDoc.objBuffer
        delete sourceLine.objData
      }
    }

    return this.sourceDocs
  }

  // private _buildDis65Docs(projectName: string, dis65: any, binData: Uint8Array): SourceDoc[] {
  //   this.changeFile(projectName)
  //   this.currentDoc.objBuffer = binData
  //
  //   const useUpperCase = this.settings.upperCase
  //   const disassembler = new Disassembler(this.currentDoc, dis65, useUpperCase)
  //   this.currentDoc.disassembler = disassembler
  //   disassembler.load()
  //   return this.sourceDocs
  // }

  public /*internal*/ changeFile(fileName: string): SourceDoc | undefined {

    // append .S to document file name, if necessary
    let tempName = fileName.toUpperCase()
    let n = tempName.lastIndexOf(".S")
    if (n != tempName.length - 2) {
      if (tempName == fileName) {
        fileName += ".S"
      } else {
        fileName += ".s"
      }
    }

    // prepend .lst file name
    if (this.lstFileName) {
      if (!fileName.startsWith("/")) {
        fileName = "/" + fileName
      }
      fileName = this.lstFileName + fileName
    }

    let previousDoc = this.currentDoc
    if (!this.currentDoc || this.currentDoc.name != fileName) {
      let matched = false
      this.sourceDocs.every(sourceDoc => {
        if (sourceDoc.name == fileName) {
          previousDoc = this.currentDoc
          this.currentDoc = sourceDoc
          matched = true
          return false
        }
        return true
      })
      if (!matched) {
        previousDoc = this.currentDoc
        this.currentDoc = new SourceDoc(this.memory, fileName, this.lstFileName ?? "", this.settings)
        this.currentDoc.objData = []
        this.sourceDocs.push(this.currentDoc)
      }
    }
    return previousDoc
  }
}

//------------------------------------------------------------------------------

// parse Merlin assembler list file and build SourceLine records

class MerlinLstParser {

  private builder: SourceDocBuilder
  private isRawText = false
  private prevLine = 0
  private macroLine?: SourceLine

  constructor(builder: SourceDocBuilder) {
    this.builder = builder
  }

  parse(lines: string[]) {
    this.isRawText = (lines[0].indexOf("===== FILE ") != 0)
    if (this.isRawText) {
      this.builder.changeFile("unknown.s")
    }

    this.prevLine = 0
    let index = 0
    for (let lineStr of lines) {
      // if last line ends in '\n', blank line gets added to lines array, so skip it
      if (index < lines.length - 1 || lineStr != "") {
        if (lineStr.indexOf("===== FILE ") == 0) {
          let fileName = lineStr.substring(11)
          const n = fileName.indexOf(" ")
          if (n > 0) {
            fileName = fileName.substring(0, n)
          }
          this.builder.changeFile(fileName)
          const l = this.builder.currentDoc!.sourceLines.length
          this.prevLine = l > 0 ? this.builder.currentDoc!.sourceLines[l - 1].fileLine! : 0
        } else {
          this.parseLine(lineStr)
        }
      }
      index += 1
    }
  }

  private parseLine(inStr: string) {

    // replace tabs with 4 spaces
    let lineStr = ""
    let startColumn = this.isRawText ? 0 : 23
    for (let i = startColumn; i < inStr.length; ++i) {
      if (inStr[i] == '\t') {
        let tabSize = 4 - (lineStr.length & 3)
        lineStr = lineStr.padEnd(lineStr.length + tabSize)
      } else {
        lineStr += inStr[i]
      }
    }

    let outLine = new SourceLine()
    outLine.objData = this.builder.currentDoc!.objData
    outLine.objLength = 0
    outLine.objOffset = outLine.objData!.length

    if (!this.isRawText) {

      // extract first 6 characters of line number
      let lineNumStr = inStr.substring(0, 6).trim()
      outLine.fileLine = parseInt(lineNumStr)

      // if there's a gap in the line numbers, a macro is being expanded
      if (outLine.fileLine != this.prevLine + 1) {
        if (!this.macroLine) {
          let n = this.builder.currentDoc!.sourceLines.length
          this.macroLine = this.builder.currentDoc!.sourceLines[n - 1]
        }
      } else if (this.macroLine) {
        this.macroLine = undefined
      }

      // extract next 16 characters of address and data bytes
      let dataStr = inStr.substring(6, 23).trim()

      // look for address and data bytes
      if (dataStr != "") {
        let n = dataStr.indexOf(":")
        if (n != -1) {
          outLine.address = parseInt(dataStr.substring(0, n), 16)
          dataStr = dataStr.substring(n + 1).trim()
        }

        for (let i = 0; i < 3; ++i) {
          let byteStr = dataStr.substring(0, 2)
          let byteValue = parseInt(byteStr, 16)
          if (this.macroLine) {
            this.macroLine.objData!.push(byteValue)
            this.macroLine.objLength += 1
            if (this.macroLine.address == -1) {
              this.macroLine.address = outLine.address
            }
          } else {
            outLine.objData!.push(byteValue)
            outLine.objLength += 1
          }

          if (dataStr.length <= 2) {
            break
          }

          dataStr = dataStr.substring(3)
        }
      }
    }

    // look for line start comment

    if (lineStr[0] == "*" || lineStr[0] == ";") {
      outLine.comment = lineStr
    } else {
      // look for label

      let labelLength = lineStr.length
      for (let i = 0; i < lineStr.length; ++i) {
        if (lineStr[i] == " " || lineStr[i] == ";") {
          labelLength = i
          break
        }
      }

      let commentColumn = lineStr.indexOf(" ;")
      if (commentColumn != -1) {
        commentColumn += 1
      }

      if (labelLength != 0) {
        outLine.label = lineStr.substring(0, labelLength)
        lineStr = lineStr.substring(labelLength)
      }

      // after label, no longer care about leading/trailing spaces
      lineStr = lineStr.trim()

      // look for opcode mnemonic

      if (lineStr != "" && lineStr[0] != ";") {
        let opLength = lineStr.length
        for (let i = 0; i < lineStr.length; ++i) {
          if (lineStr[i] == " " || lineStr[i] == ";") {
            opLength = i
            break
          }
        }

        if (opLength != 0) {
          outLine.opcode = lineStr.substring(0, opLength)
          lineStr = lineStr.substring(opLength)
        }

        lineStr = lineStr.trim()
      }

      // look for arguments

      if (lineStr != "" && lineStr[0] != ";") {
        let argLength = lineStr.length
        for (let i = 0; i < lineStr.length; ++i) {
          if (lineStr[i] == " ") {
            if (i + 1 < lineStr.length && lineStr[i + 1] == ";") {
              argLength = i
              break
            }
          }
        }

        if (argLength != 0) {
          outLine.args = lineStr.substring(0, argLength).trim()
          lineStr = lineStr.substring(argLength)
        }

        lineStr = lineStr.trim()
      }

      // look for comment

      if (lineStr != "" && lineStr[0] == ";") {
        outLine.comment = lineStr
        if (commentColumn != -1) {
          outLine.commentColumn = commentColumn
        }
        lineStr = ""
      }
    }

    if (!this.macroLine) {
      this.prevLine = outLine.fileLine!
      this.builder.currentDoc!.sourceLines.push(outLine)
    }
  }
}

//------------------------------------------------------------------------------

// parse DASM assembler list file and build SourceLine records

class DasmLstParser {

  private builder: SourceDocBuilder
  private lastAddress = -1
  private nextAddress = -1
  private previousDoc?: SourceDoc
  private macroLine?: SourceLine
  private macroLineIndex = -1

  constructor(builder: SourceDocBuilder) {
    this.builder = builder
  }

  parse(lines: string[]) {
    this.lastAddress = -1
    this.nextAddress = -1
    this.previousDoc = undefined
    this.macroLine = undefined
    this.macroLineIndex = -1
    let index = 0
    for (let lineStr of lines) {
      // if last line ends in '\n', blank line gets added to lines array, so skip it
      if (index < lines.length - 1 || lineStr != "") {
        if (lineStr.indexOf("------- FILE ") == 0) {
          let fileName = lineStr.substring(13)
          let n = fileName.indexOf(" ")
          if (n > 0) {
            fileName = fileName.substring(0, n)
          }
          this.previousDoc = this.builder.changeFile(fileName)
        } else {
          this.parseLine(lineStr)
        }
      }
      index += 1
    }
  }

  private parseLine(inStr: string) {

    // replace tabs with 8 spaces
    let lineStr = ""
    let sawComment = false
    for (let i = 0; i < inStr.length; ++i) {
      if (inStr[i] == '\t') {
        let tabSize = 8 - (lineStr.length & 7)

        // workarounds for dasm tab padding bugs
        //
        // ignore extra tab character inserted before comment
        if ((i + 1) < lineStr.length && inStr[i + 1] == ";") {
          continue
        }
        // adjust for removed tab in position calculation
        if (sawComment) {
          tabSize = 8 - ((lineStr.length + 1) & 7)
        }

        lineStr = lineStr.padEnd(lineStr.length + tabSize)
      } else {
        if (inStr[i] == ';') {
          sawComment = true
        }
        lineStr += inStr[i]
      }
    }

    let outLine = new SourceLine()
    outLine.objData = this.builder.currentDoc!.objData
    outLine.objLength = 0
    outLine.objOffset = outLine.objData!.length
    let objBytes = []

    let lineNumStr = lineStr.substring(0, 7)
    lineStr = lineStr.substring(8)    // eat trailing space too

    outLine.fileLine = parseInt(lineNumStr)

    let hexAddrStr = lineStr.substring(1, 5)
    lineStr = lineStr.substring(5)    // eat leading space too
    outLine.address = parseInt(hexAddrStr, 16)
    this.nextAddress = outLine.address

    // look for mystery field after address (always ???? right now)

    if (lineStr != "") {
      let someStr = lineStr.substring(1, 5).trim()
      lineStr = lineStr.substring(5)    // eat leading space too

      if (someStr == "????") {
        outLine.address = -1
      } else if (someStr != "") {
        // TODO: format error
        console.log("format error 1")
      }
    }

    // look for 13 spaces of padding before hex data

    if (lineStr != "") {
      if (lineStr.length < 13) {
        // TODO: format error
        console.log("format error 2")
      }

      let paddingStr = lineStr.substring(0, 13)
      lineStr = lineStr.substring(13)

      if (paddingStr.trim() != "") {
        // TODO: format error
        console.log("format error 3")
      }
    }

    // look for hex data

    if (lineStr != "") {
      if (lineStr.length < 12) {
        // TODO: format error
        console.log("format error 4")
      }

      let hexStr = lineStr.substring(0, 12).trim()
      lineStr = lineStr.substring(12)

      // TODO: handle '-' of excluded conditional assembly
      // TODO: maybe exclude completely?

      if (hexStr != "" && hexStr != "-" && outLine.address != -1) {
        for (let i = 0; i < 4; ++i) {
          let byteStr = hexStr.substring(0, 2)
          let byteValue = parseInt(byteStr, 16)
          objBytes.push(byteValue)

          if (hexStr.length <= 2 || hexStr[2] == "*") {
            break
          }

          hexStr = hexStr.substring(3)
        }
      }
    }

    // look for label

    if (lineStr != "" && lineStr[0] != " " && lineStr[0] != ";") {
      let labelLength = lineStr.length
      for (let i = 0; i < lineStr.length; ++i) {
        if (lineStr[i] == " " || lineStr[i] == ";") {
          labelLength = i
          break
        }
      }

      if (labelLength != 0) {
        outLine.label = lineStr.substring(0, labelLength)
        lineStr = lineStr.substring(labelLength)
      }
    }

    // after label, no longer care about leading/trailing spaces
    lineStr = lineStr.trim()

    // look for opcode mnemonic

    if (lineStr != "" && lineStr[0] != ";") {
      let opLength = lineStr.length
      for (let i = 0; i < lineStr.length; ++i) {
        if (lineStr[i] == " " || lineStr[i] == ";") {
          opLength = i
          break
        }
      }

      if (opLength != 0) {
        outLine.opcode = lineStr.substring(0, opLength)
        lineStr = lineStr.substring(opLength)
      }

      lineStr = lineStr.trim()
    }

    // look for arguments

    if (lineStr != "" && lineStr[0] != ";") {
      let argLength = lineStr.length
      for (let i = 0; i < lineStr.length; ++i) {
        if (lineStr[i] == ";") {
          argLength = i
          break
        }
      }

      if (argLength != 0) {
        outLine.args = lineStr.substring(0, argLength).trim()
        lineStr = lineStr.substring(argLength)
      }

      lineStr = lineStr.trim()
    }

    // look for comment
    //
    // NOTE: commentColumn is not tracked for dasm due to
    //  a bug in .lst file generation

    if (lineStr != "" && lineStr[0] == ";") {
      outLine.comment = lineStr
      lineStr = ""
    }

    // Dasm .lst files incorrectly use the aligned ending address rather than
    //  the unaligned starting address. Correct for that here.
    if (outLine.opcode.toLowerCase() === "align") {
      outLine.address = this.lastAddress
    }

    // ignore data bytes that are generated as part of variable declarations
    // TODO: track these as symbols
    if (outLine.opcode.toLowerCase() === "equ" || outLine.opcode === "=") {
      objBytes = []
    }

    this.lastAddress = this.nextAddress

    // consume all expanded macros lines
    if (this.macroLine) {
      this.macroLineIndex += 1
      if (outLine.fileLine == this.macroLineIndex) {
        this.macroLine.objData!.push(...objBytes)
        this.macroLine.objLength += objBytes.length
        return
      }

      this.macroLine = undefined
      this.macroLineIndex = -1
    }

    outLine.objData!.push(...objBytes)
    outLine.objLength = objBytes.length

    // special case transition between files or macros
    if (outLine.fileLine == 0) {
      if (outLine.opcode == "include") {
        // TODO: is this possible? throw format error?
        if (!this.previousDoc) {
          return
        }
        // NOTE: In dasm list files, the first line after a file change is the
        //  include operation that changed the file.  It's line number is 0
        //  instead of the correct value, so compute it here.
        let prevLine = this.previousDoc.sourceLines[this.previousDoc.sourceLines.length - 1]
        outLine.fileLine = prevLine.fileLine! + 1
        this.previousDoc.sourceLines.push(outLine)
        return
      } else {
        // starting a macro expansion
        let currentDoc = this.builder.currentDoc!
        let prevLine = currentDoc.sourceLines[currentDoc.sourceLines.length - 1]
        outLine.fileLine = prevLine.fileLine! + 1
        this.macroLine = outLine
        this.macroLineIndex = 0
      }
    }

    this.builder.currentDoc!.sourceLines.push(outLine)
  }
}

//------------------------------------------------------------------------------

// parse ca65 assembler list file and build SourceLine records

class Ca65LstParser {

  private builder: SourceDocBuilder
  private lastDepth = -1
  private nextDepth = 1
  private docStack: string[] = []
  private prevLine?: SourceLine

  constructor(builder: SourceDocBuilder) {
    this.builder = builder
  }

  parse(lines: string[]) {
    this.lastDepth = -1
    this.nextDepth = 1

    this.docStack = []

    // TODO: better scanning of header?

    //  ca65 V2.18 - N/A
    //  Main file   : <filename>
    //  Current file: <filename>
    //

    let index = 0
    for (let lineStr of lines) {
      if (index < 4) {
        if (lineStr.startsWith("Current file: ")) {
          const fileName = lineStr.substring(14).trim()
          this.docStack.push(fileName)
          this.builder.changeFile(fileName)
        }
        index += 1
        continue
      }
      // if last line ends in '\n', blank line gets added to lines array, so skip it
      if (index < lines.length - 1 || lineStr != "") {
        this.parseLine(lineStr)
      }
      index += 1
    }
  }

  private parseLine(inStr: string) {

    // TODO: is the conversion to spaces really needed?
    // TODO: should tab size come from settings somewhere?

    // replace tabs with 4 spaces
    let lineStr = ""
    for (let i = 0; i < inStr.length; ++i) {
      if (inStr[i] == '\t') {
        let tabSize = 4 - (lineStr.length & 3)
        lineStr = lineStr.padEnd(lineStr.length + tabSize)
      } else {
        lineStr += inStr[i]
      }
    }

    const outLine = new SourceLine()
    outLine.objData = this.builder.currentDoc!.objData
    outLine.objLength = 0
    outLine.objOffset = outLine.objData!.length
    let objBytes = []

    // 6 digits of hex address
    const hexAddrStr = lineStr.substring(0, 6)
    lineStr = lineStr.substring(6)
    outLine.address = parseInt(hexAddrStr, 16)

    // either " " or "r"
    const flagChar = lineStr.substring(0, 1)
    lineStr = lineStr.substring(1+1)  // eat 1 trailing space too

    // include nesting depth
    const depthStr = lineStr.substring(0, 1)
    lineStr = lineStr.substring(1+2)  // eat 2 trailing spaces too
    this.nextDepth = parseInt(depthStr)

    if (this.nextDepth > this.lastDepth) {
      if (this.prevLine) {
        let fileName: string | undefined
        if (this.prevLine.label == ".include") {
          fileName = this.prevLine.opcode
        } else if (this.prevLine.opcode = ".include") {
          fileName = this.prevLine.args
        }
        if (fileName) {
          // strip quotes
          fileName = fileName.substring(1, 1 + fileName.length - 2)
          this.docStack.push(fileName)
          this.builder.changeFile(fileName)
        }
      }
    } else if (this.nextDepth < this.lastDepth) {
      this.docStack.pop()
      const fileName = this.docStack[this.docStack.length - 1]
      this.builder.changeFile(fileName)
    }
    this.lastDepth = this.nextDepth

    // up to 4 bytes of hex object data
    let hexDataStr = lineStr.substring(0, 13)
    lineStr = lineStr.substring(13)
    let sawAlignData = false
    for (let i = 0; i < 12; i += 3) {
      const byteStr = hexDataStr.substring(i, i + 2)
      if (byteStr == "xx") {
        sawAlignData = true
        break
      }
      if (byteStr == "  ") {
        break
      }
      const byteValue = parseInt(byteStr, 16)
      objBytes.push(byteValue)
    }

    let commentColumn = lineStr.indexOf(";")

    // process actual source line
    if (lineStr != "") {

      // look for label
      // TODO: deal with indented labels and non-indented opcodes
      if (lineStr != "" && lineStr[0] != " " && lineStr[0] != ";") {
        let labelLength = lineStr.length
        for (let i = 0; i < lineStr.length; ++i) {
          if (lineStr[i] == " " || lineStr[i] == ";") {
            labelLength = i
            break
          }
        }

        if (labelLength != 0) {
          outLine.label = lineStr.substring(0, labelLength)
          lineStr = lineStr.substring(labelLength)
        }
      }

      // after label, no longer care about leading/trailing spaces
      lineStr = lineStr.trim()

      // look for opcode mnemonic
      if (lineStr != "" && lineStr[0] != ";") {
        let opLength = lineStr.length
        for (let i = 0; i < lineStr.length; ++i) {
          if (lineStr[i] == " " || lineStr[i] == ";") {
            opLength = i
            break
          }
        }
        if (opLength != 0) {
          outLine.opcode = lineStr.substring(0, opLength)
          lineStr = lineStr.substring(opLength)
        }
        lineStr = lineStr.trim()
      }

      // look for arguments
      if (lineStr != "" && lineStr[0] != ";") {
        let argLength = lineStr.length
        for (let i = 0; i < lineStr.length; ++i) {
          if (lineStr[i] == ";") {
            argLength = i
            break
          }
        }
        if (argLength != 0) {
          outLine.args = lineStr.substring(0, argLength).trim()
          lineStr = lineStr.substring(argLength)
        }
        lineStr = lineStr.trim()
      }

      // look for comment
      if (lineStr != "" && lineStr[0] == ";") {
        outLine.comment = lineStr
        if (commentColumn != -1) {
          outLine.commentColumn = commentColumn
        }
        lineStr = ""
      }
    } else {
      if (sawAlignData) {
        // throw away empty lines that just have "xx" alignment placeholders
        return
      }
      if (objBytes.length > 0) {
        // throw away bytes that are overflow from a previous line
        // TODO: capture them all but reuse line number?
        return
      }
    }

    outLine.objData!.push(...objBytes)
    outLine.objLength = objBytes.length

    this.prevLine = outLine
    this.builder.currentDoc!.sourceLines.push(outLine)
  }
}

//------------------------------------------------------------------------------
