export class CallSite {
  fileName?: string;
  lineNumber?: number;
  functionName?: string;
  typeName?: string;
  methodName?: string;
  columnNumber?: number;
  native?: boolean;
  constructor(site: string | CallSite) {
    if (typeof site === "string") {
      this.parse(site);
    }

    if (site instanceof CallSite) {
      Object.assign(this, site);
    }
  }

  parse(line: string) {
    if (line.match(/^\s*[-]{4,}$/)) {
      this.fileName = line;
      return this;
    }

    const lineReg = /at (?:(.+?)\s+\()?(?:(.+?):(\d+)(?::(\d+))?|([^)]+))\)?/;
    const lineMatch = line.match(lineReg);
    if (!lineMatch) {
      return this;
    }

    let object = null;
    let method = null;
    let functionName = null;
    let typeName = null;
    let methodName = null;
    let isNative = lineMatch[5] === "native";

    if (lineMatch[1]) {
      functionName = lineMatch[1];
      let methodStart = functionName.lastIndexOf(".");
      if (functionName[methodStart - 1] == ".") methodStart--;
      if (methodStart > 0) {
        object = functionName.substr(0, methodStart);
        method = functionName.substr(methodStart + 1);
        const objectEnd = object.indexOf(".Module");
        if (objectEnd > 0) {
          functionName = functionName.substr(objectEnd + 1);
          object = object.substr(0, objectEnd);
        }
      }
    }

    if (method) {
      typeName = object;
      methodName = method;
    }

    if (method === "<anonymous>") {
      methodName = null;
      functionName = null;
    }

    const properties = {
      fileName: lineMatch[2] || null,
      lineNumber: parseInt(lineMatch[3], 10) || null,
      functionName: functionName,
      typeName: typeName,
      methodName: methodName,
      columnNumber: parseInt(lineMatch[4], 10) || null,
      native: isNative,
    };

    Object.assign(this, properties);
    return this;
  }

  valueOf() {
    return {
      fileName: this.fileName,
      lineNumber: this.lineNumber,
      functionName: this.functionName,
      typeName: this.typeName,
      methodName: this.methodName,
      columnNumber: this.columnNumber,
      native: this.native,
    };
  }

  toString() {
    return JSON.stringify(this.valueOf());
  }
}
