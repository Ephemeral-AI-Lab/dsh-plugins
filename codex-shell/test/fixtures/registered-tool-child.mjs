const mode = process.argv[2] ?? ''

if (mode === 'foreground') {
  process.stdout.write('PASS foreground\n')
} else if (mode === 'fail') {
  process.stderr.write('FAIL simulated command\n')
  process.exitCode = 1
} else if (mode === 'slow') {
  setTimeout(() => {
    process.stdout.write('PASS slow\n')
  }, 100)
} else if (mode.startsWith('interactive:')) {
  const label = mode.slice('interactive:'.length)
  let input = ''
  process.stdout.write(`READY ${label}\n`)
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', chunk => {
    input += chunk
    let newline = input.indexOf('\n')
    while (newline !== -1) {
      const line = input.slice(0, newline).trim()
      input = input.slice(newline + 1)
      if (line === 'PASS') {
        process.stdout.write(`PASS ${label}\n`)
        process.exitCode = 0
        process.stdin.destroy()
        return
      }
      if (line === 'FAIL') {
        process.stderr.write(`FAIL ${label}\n`)
        process.exitCode = 1
        process.stdin.destroy()
        return
      }
      newline = input.indexOf('\n')
    }
  })
} else {
  process.stderr.write(`FAIL unknown fixture mode: ${mode}\n`)
  process.exitCode = 1
}
