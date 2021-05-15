import assert from 'assert'
import fs from 'fs'
import {IFS} from 'unionfs/lib/fs'
import path from 'path'
import slimdom from 'slimdom'
import {sync as parseXML} from 'slimdom-sax-parser'
import {
  evaluateXPath, evaluateXPathToNodes, evaluateXPathToFirstNode, evaluateXPathToString,
  registerCustomXPathFunction, registerXQueryModule, Options,
} from 'fontoxpath'
import {Expander, replacePathPrefix} from './expander'
import Debug from 'debug'

const debug = Debug('nancy-xml')

const nc = 'https://github.com/rrthomas/nancy/raw/master/nancy.dtd'
const URI_BY_PREFIX: {[key: string]: string} = {nc}

const xQueryOptions: Options = {
  namespaceResolver: (prefix: string) => URI_BY_PREFIX[prefix],
  language: evaluateXPath.XQUERY_3_1_LANGUAGE,
}

export class XMLExpander extends Expander {
  private xtree: slimdom.Document

  constructor(input: string, output: string, path?: string, abortOnError?: boolean, inputFs?: IFS) {
    super(input, output, path, abortOnError, inputFs)
    this.xtree = this.dirTreeToXML(this.input)
    registerCustomXPathFunction(
      {localName: 'paste', namespaceURI: nc},
      // FIXME: 'array(xs:string)' doesn't work in the next line: https://github.com/FontoXML/fontoxpath/issues/360
      ['array(*)'], 'xs:string',
      (_, args: string): string => {
        // const file = getFile(args[0])
        // return readFile(file, args.slice(1))
        return args[0]
      },
    )
  }

  private dirTreeToXML(root: string) {
    const xtree = new slimdom.Document()
    const objToNode = (obj: string) => {
      const stats = this.inputFs.statSync(obj)
      const parsedPath = path.parse(obj)
      let elem: slimdom.Element
      if (stats.isDirectory()) {
        elem = xtree.createElementNS(nc, 'directory')
        elem.setAttributeNS(nc, 'type', 'directory')
        const dir = this.inputFs.readdirSync(obj, {withFileTypes: true})
          .filter(dirent => dirent.name[0] !== '.')
        const dirs = dir.filter(dirent => dirent.isDirectory())
        const files = dir.filter(dirent => !(dirent.isDirectory()))
        dirs.forEach((dirent) => elem.appendChild(objToNode(path.join(obj, dirent.name))))
        files.forEach((dirent) => elem.appendChild(objToNode(path.join(obj, dirent.name))))
      } else if (stats.mode & fs.constants.X_OK) {
        elem = xtree.createElementNS(nc, 'executable')
      } else if (stats.isFile()) {
        const basename = (/^[^.]*/.exec(parsedPath.name) as string[])[0]
        if (['.xml', '.xhtml'].includes(parsedPath.ext)) {
          const text = this.inputFs.readFileSync(obj, 'utf-8')
          const wrappedText = `<${basename}>${text}</${basename}>`
          let doc
          try {
            doc = parseXML(wrappedText, {additionalNamespaces: URI_BY_PREFIX})
          } catch (error) {
            throw new Error(`error parsing '${obj}': ${error}`)
          }
          assert(doc.documentElement !== null)
          elem = doc.documentElement
        } else {
          if (/.xq[lmy]?/.test(parsedPath.ext)) {
            registerXQueryModule(this.inputFs.readFileSync(obj, 'utf-8'));
            xQueryOptions.moduleImports = URI_BY_PREFIX
          }
          elem = xtree.createElementNS(nc, 'file')
        }
        elem.setAttributeNS(nc, 'type', 'file')
      } else {
        elem = xtree.createElement('unknown')
      }
      elem.setAttributeNS(nc, 'path', obj)
      elem.setAttributeNS(nc, 'name', parsedPath.base)
      return elem
    }
    const rootElem = objToNode(root)
    xtree.appendChild(rootElem)
    return xtree
  }

  private nodePath(elem: slimdom.Element) {
    const filePath = []
    for (
      let n: slimdom.Node | null = elem;
      n !== null && n !== this.xtree.documentElement;
      n = n.parentNode
    ) {
      const e = n as slimdom.Element
      filePath.unshift(e.getAttributeNS(nc, 'name'))
    }
    return filePath.join(path.sep)
  }

  expandFile(baseFile: string): string {
    const xQueryVariables = {
      root: this.input,
      path: replacePathPrefix(path.dirname(baseFile), this.input)
        .replace(Expander.templateRegex, '.'),
    }

    // FIXME: annotate error with location
    const query = (xQuery: string, node: slimdom.Node) => {
      return evaluateXPathToNodes(xQuery, node, null, xQueryVariables, xQueryOptions)
    }

    // FIXME: annotate error with location
    const queryFirst = (xQuery: string, node: slimdom.Node): slimdom.Node | null => {
      return evaluateXPathToFirstNode(xQuery, node, null, xQueryVariables, xQueryOptions)
    }

    // FIXME: annotate error with location
    const queryString = (xQuery: string, node: slimdom.Node): string => {
      return evaluateXPathToString(xQuery, node, null, xQueryVariables, xQueryOptions)
    }

    const index = (filePath: string) => {
      const components = replacePathPrefix(filePath, path.dirname(this.input)).split(path.sep)
      const xPathComponents = components.map((c) => `*[@nc:name="${c}"]`)
      const query = '/' + xPathComponents.join('/')
      return queryFirst(query, this.xtree)
    }

    const anchor = index(baseFile) as slimdom.Element
    if (anchor === null) {
      throw new Error(`path '${this.path}' does not exist in '${this.input}'`)
    }

    const expandNode = (elem: slimdom.Element, stack: slimdom.Node[]): slimdom.Node[] => {
      const doExpand = (queryElem: slimdom.Element, xQuery: string, errorAttr: string): slimdom.Node[] | null => {
        try {
          const searchXPath = `ancestor::nc:directory/${xQuery}`
          const matchElems = query(searchXPath, anchor) as slimdom.Element[]
          for (const matchElem of matchElems) {
            if (!stack.includes(matchElem)) {
              return expandNode(matchElem, stack.concat(matchElem))
            }
          }
          throw new Error(`${xQuery} not found for ${this.nodePath(elem)}`)
        } catch (error) {
          if (this.abortOnError) {
            throw error
          }
          queryElem.setAttributeNS(nc, errorAttr, `${error}`)
        }
        return null
      }

      // Copy element to be expanded, and find queries
      const resElem = elem.cloneNode(true)
      const queries = query('descendant::nc:x', resElem) as slimdom.Element[]
      const attrQueries = query(`descendant::*[@*[namespace-uri()="${nc}"]]`, resElem) as slimdom.Element[]

      // Process element queries
      for (const queryElem of queries) {
        const expandedNodes = doExpand(queryElem, queryElem.textContent ?? '', 'error')
        if (expandedNodes) {
          queryElem.replaceWith(...expandedNodes)
        }
      }

      // Process attribute queries
      for (const queryElem of attrQueries) {
        const attrs = query(`./@*[namespace-uri()="${nc}"]`, queryElem) as slimdom.Attr[]
        for (const attr of attrs) {
          queryElem.removeAttributeNS(nc, attr.localName)
          try {
            const expandedText = queryString(attr.value, anchor)
            queryElem.setAttribute(attr.localName, expandedText)
          } catch (error) {
            if (this.abortOnError) {
              throw error
            }
            queryElem.setAttributeNS(nc, attr.localName, `${error}`)
          }
        }
      }

      return resElem.childNodes
    }

    let res = ''
    const expandedNodes = expandNode(anchor, [anchor])
    for (const node of expandedNodes) {
      res += slimdom.serializeToWellFormedString(node)
    }
    return res
  }
}
