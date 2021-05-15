import util from 'util'
import fs from 'fs'
import path from 'path'
import execa from 'execa'
import {directory} from 'tempy'
import {compareSync, Difference} from 'dir-compare'
import chai from 'chai'
import chaiAsPromised from 'chai-as-promised'

chai.use(chaiAsPromised)
const expect = chai.expect
const assert = chai.assert

const nancyCmd = '../bin/run'

async function runNancy(args: string[]) {
  return execa(nancyCmd, args)
}

function assertFileObjEqual(obj: string, expected: string) {
  const stats = fs.statSync(obj)
  if (stats.isDirectory()) {
    const compareResult = compareSync(obj, expected, {compareContent: true})
    assert(compareResult.same, util.inspect(diffsetDiffsOnly(compareResult.diffSet as Difference[])))
  } else {
    assert(
      fs.readFileSync(obj).equals(fs.readFileSync(expected)),
      `'${obj}' does not match expected '${expected}'`
    )
  }
}

function diffsetDiffsOnly(diffSet: Difference[]): Difference[] {
  return diffSet.filter((diff) => diff.state !== 'equal')
}

async function nancyTest(args: string[], expected: string) {
  const outputDir = directory()
  const outputObj = path.join(outputDir, 'output')
  args.push(outputObj)
  await runNancy(args)
  assertFileObjEqual(outputObj, expected)
  fs.rmdirSync(outputDir, {recursive: true})
}

describe('nancy', function () {
  // The tests are rather slow, but not likely to hang.
  this.timeout(10000)

  before(function () {
    process.chdir('test')
  })

  it('--help should produce output', async () => {
    const proc = runNancy(['--help'])
    const {stdout} = await proc
    expect(stdout).to.contain('A simple templating system.')
  })

  it('Whole-tree test', async () => {
    await nancyTest(['--keep-going', 'webpage-src'], 'webpage-expected')
  })

  it('Whole-tree test (XML)', async () => {
    await nancyTest(['--keep-going', '--expander=xml', 'webpage-xml-src'], 'webpage-xhtml-expected')
  })

  it('Part-tree test', async () => {
    await nancyTest(['--keep-going', 'webpage-src', '--path=people'], 'webpage-expected/people')
  })

  it('Part-tree test (XML)', async () => {
    await nancyTest(['--keep-going', '--expander=xml', 'webpage-xml-src', '--path=people'], 'webpage-xhtml-expected/people')
  })

  it('Two-tree test', async () => {
    await nancyTest(['--keep-going', 'mergetrees-src:webpage-src'], 'mergetrees-expected')
  })

  it('Two-tree test (XML)', async () => {
    await nancyTest(['--keep-going', '--expander=xml', 'mergetrees-xml-src:webpage-xml-src'], 'mergetrees-xhtml-expected')
  })

  it('Test nested macro invocations', async () => {
    await nancyTest(['nested-macro-src'], 'nested-macro-expected')
  })

  it('Failing executable test', async () => {
    return assert.isRejected(runNancy(['false.nancy.txt', 'dummy']))
  })

  it('Passing executable test', async () => {
    await nancyTest(['true.nancy.txt'], 'true-expected.txt')
  })

  it('Executable test with in-tree executable', async () => {
    await nancyTest(['page-template-with-date-src'], 'page-template-with-date-expected')
  })

  it('Test that macros aren\'t expanded in Nancy\'s command-line arguments', async () => {
    await nancyTest(['$path-src'], '$path-expected')
  })

  it('Test that $paste doesn\'t expand macros', async () => {
    await nancyTest(['paste-src'], 'paste-expected')
  })

  it('Cookbook web site example', async () => {
    await nancyTest(['cookbook-example-website-src'], 'cookbook-example-website-expected')
  })

  it('Cookbook web site example (XML)', async () => {
    await nancyTest(['--expander=xml', 'cookbook-example-website-xml-src'], 'cookbook-example-website-xhtml-expected')
  })
})
