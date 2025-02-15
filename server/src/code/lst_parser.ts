
import { Module, SourceFile, DataRange } from "../asm/project"

//------------------------------------------------------------------------------

// *** just a type?
class ObjectLine {

  public address: number = -1
  public objBuffer?: Uint8Array
  public objOffset: number = 0
  public objLength: number = 0
  // public srcLineNumber: number = -1

  // NOTE: only valid during build and deleted afterwards
  fileLine?: number
  objData?: number[]

  constructor() {
    // ***
  }
}

export class ObjectDoc {

  private module: Module

  // *** rename to be more descriptive ***
  public name: string             // full path name
  // public sourceFile?: SourceFile  // *** link this up ***
  public objBuffer?: Uint8Array       // *** or dummy array?
  public objectLines: ObjectLine[] = []

  // NOTE: only valid during build and deleted afterwards
  public objData?: number[]

  constructor(module: Module, fullPathName: string) {
    this.module = module
    this.name = fullPathName
  }

  private findLinesByAddress(address: number): number[] {
    let results = []
    // TODO: change this to a binary search by group for better perf
    for (let i = 0; i < this.objectLines.length; i += 1) {
      const objectLine = this.objectLines[i]
      if (address >= objectLine.address && address < objectLine.address + objectLine.objLength) {
        results.push(i)
      }
    }
    return results
  }

  public findLineByAddress(address: number, dataRange?: DataRange): number {
    const results = this.findLinesByAddress(address)
    let result = -1
    if (results.length > 0) {
      if (results.length > 1 && dataRange) {
        // if more than one match is found, return the one that most matches memory
        let bestCount = -1
        for (let value of results) {
          const objectLine = this.objectLines[value]
          let matchCount = 0
          for (let i = 0; i < objectLine.objLength; i += 1) {
            matchCount += dataRange.compare(objectLine.address, objectLine.objBuffer!, objectLine.objOffset, objectLine.objLength)
          }
          matchCount /= objectLine.objLength
          if (bestCount < matchCount) {
            bestCount = matchCount
            result = value
          }
        }
      } else {
        result = results[0]
      }
    }
    return result
  }

  public calcLoadedPercent(dataRange: DataRange): number {
    let matchCount = 0
    let byteCount = 0
    for (let objectLine of this.objectLines) {
      if (objectLine.address + objectLine.objLength <= dataRange.address) {
        continue
      }
      if (objectLine.address >= dataRange.address + dataRange.bytes.length) {
        continue
      }
      // NOTE: not exactly right because line may straddle bounds of dataRange
      byteCount += objectLine.objLength
      matchCount += dataRange.compare(objectLine.address, objectLine.objBuffer!, objectLine.objOffset, objectLine.objLength)
    }
    if (byteCount == 0) {
      return 0
    }
    return matchCount / byteCount
  }
}

//------------------------------------------------------------------------------

export class ObjectDocBuilder {

  private module: Module
  private objectDocs: ObjectDoc[] = []
  public /*internal*/ currentDoc?: ObjectDoc

  static buildDocs(module: Module, lines: string[]): ObjectDoc[] {
    const builder = new ObjectDocBuilder(module)
    return builder._buildDocs(lines)
  }

  constructor(module: Module) {
    this.module = module
  }

  private _buildDocs(lines: string[]) {

    // if (lines[0].startsWith("ca65")) {
    //   const parser = new Ca65LstParser(this)
    //   parser.parse(lines)
    // } else if (lines[0].indexOf("------- FILE ") == 0) {
    //   const parser = new DasmLstParser(this)
    //   parser.parse(lines)
    // } else {
      const parser = new MerlinLstParser(this)
      parser.parse(lines)
    // }

    // trim documents that don't have any actual code in them
    // TODO: should this be optional?
    this.objectDocs = this.objectDocs.filter((objectDoc: ObjectDoc) => {
      let removeDoc = true
      for (let i = 0; i < objectDoc.objectLines.length; i += 1) {
        if (objectDoc.objectLines[i].address != -1) {
          removeDoc = false
          break
        }
      }
      return !removeDoc
    })

    for (let objectDoc of this.objectDocs) {
      // build final Uint8Array for each document
      objectDoc.objBuffer = Uint8Array.from(objectDoc.objData!)
      delete objectDoc.objData
      // remove fileLine property and initialize line number index
      // remove objData array and replace with final objBuffer Uint8Array
      for (let objectLine of objectDoc.objectLines) {
        delete objectLine.fileLine
        objectLine.objBuffer = objectDoc.objBuffer
        delete objectLine.objData
      }
    }

    return this.objectDocs
  }

  public changeFile(fileName: string): ObjectDoc | undefined {

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

    // prepend srcDir and srcPath to get full path
    if (!fileName.startsWith("/")) {
      fileName = "/" + fileName
    }
    fileName = this.module!.project.srcDir + this.module!.srcPath + fileName

    let previousDoc = this.currentDoc
    if (!this.currentDoc || this.currentDoc.name != fileName) {
      let matched = false
      this.objectDocs.every(objectDoc => {
        if (objectDoc.name == fileName) {
          previousDoc = this.currentDoc
          this.currentDoc = objectDoc
          matched = true
          return false
        }
        return true
      })
      if (!matched) {
        previousDoc = this.currentDoc
        this.currentDoc = new ObjectDoc(this.module, fileName)
        this.currentDoc.objData = []
        this.objectDocs.push(this.currentDoc)
      }
    }
    return previousDoc
  }
}

//------------------------------------------------------------------------------

// parse Merlin assembler list file and build ObjectLine records

class MerlinLstParser {

  private builder: ObjectDocBuilder
  private prevLine = 0
  private macroLine?: ObjectLine

  constructor(builder: ObjectDocBuilder) {
    this.builder = builder
  }

  parse(lines: string[]) {
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
          const l = this.builder.currentDoc!.objectLines.length
          this.prevLine = l > 0 ? this.builder.currentDoc!.objectLines[l - 1].fileLine! : 0
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
    const startColumn = 23
    for (let i = startColumn; i < inStr.length; ++i) {
      if (inStr[i] == '\t') {
        let tabSize = 4 - (lineStr.length & 3)
        lineStr = lineStr.padEnd(lineStr.length + tabSize)
      } else {
        lineStr += inStr[i]
      }
    }

    const outLine = new ObjectLine()
    outLine.objData = this.builder.currentDoc!.objData
    outLine.objLength = 0
    outLine.objOffset = outLine.objData!.length

    // extract first 6 characters of line number
    let lineNumStr = inStr.substring(0, 6).trim()
    outLine.fileLine = parseInt(lineNumStr)

    // if there's a gap in the line numbers, a macro is being expanded
    if (outLine.fileLine != this.prevLine + 1) {
      if (!this.macroLine) {
        let n = this.builder.currentDoc!.objectLines.length
        this.macroLine = this.builder.currentDoc!.objectLines[n - 1]
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

    if (!this.macroLine) {
      this.prevLine = outLine.fileLine!
      this.builder.currentDoc!.objectLines.push(outLine)
    }
  }
}

//------------------------------------------------------------------------------
