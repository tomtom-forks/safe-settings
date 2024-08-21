function configureMockLogger() {
  const childLogger = { debug: jest.fn(), error: jest.fn() }
  return { child: jest.fn(() => childLogger), debug: jest.fn(), error: console.error }
}

module.exports = {
  configureMockLogger
}
