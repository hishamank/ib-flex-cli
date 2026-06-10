import { test } from "node:test";
import assert from "node:assert/strict";
import { parseQuery, getSection } from "./parse.js";

const XML = `<FlexQueryResponse queryName="positions" type="AF">
 <FlexStatements count="1">
  <FlexStatement accountId="U123" fromDate="20250101" toDate="20251231" period="LastYear" whenGenerated="20251231;120000">
    <AccountInformation accountId="U123" name="Jane Doe" currency="USD"/>
    <OpenPositions>
      <OpenPosition symbol="AAPL" position="100" currency="USD"/>
      <OpenPosition symbol="MSFT" position="50" currency="USD"/>
    </OpenPositions>
    <Trades>
      <Trade symbol="AAPL" buySell="BUY" quantity="100"/>
    </Trades>
    <EmptySection></EmptySection>
  </FlexStatement>
 </FlexStatements>
</FlexQueryResponse>`;

test("parses statement attributes", () => {
  const { statements } = parseQuery(XML);
  assert.equal(statements.length, 1);
  const s = statements[0];
  assert.equal(s.account, "U123");
  assert.equal(s.fromDate, "20250101");
  assert.equal(s.toDate, "20251231");
});

test("a multi-row section yields one row per child element", () => {
  const s = parseQuery(XML).statements[0];
  assert.deepEqual(getSection(s, "OpenPositions"), [
    { symbol: "AAPL", position: "100", currency: "USD" },
    { symbol: "MSFT", position: "50", currency: "USD" },
  ]);
});

test("a section with a single child still yields an array of one row", () => {
  // fast-xml-parser does not wrap a lone child in an array; toArray must.
  const s = parseQuery(XML).statements[0];
  assert.deepEqual(getSection(s, "Trades"), [
    { symbol: "AAPL", buySell: "BUY", quantity: "100" },
  ]);
});

test("a single-record section becomes one row of its attributes", () => {
  const s = parseQuery(XML).statements[0];
  assert.deepEqual(getSection(s, "AccountInformation"), [
    { accountId: "U123", name: "Jane Doe", currency: "USD" },
  ]);
});

test("getSection returns [] for an absent or empty section", () => {
  const s = parseQuery(XML).statements[0];
  assert.deepEqual(getSection(s, "EmptySection"), []); // empty sections are dropped
  assert.deepEqual(getSection(s, "DoesNotExist"), []);
});

test("numeric-looking values stay strings (no float coercion)", () => {
  const xml = XML.replace('position="100"', 'position="100.123456789"');
  const s = parseQuery(xml).statements[0];
  assert.equal(getSection(s, "OpenPositions")[0].position, "100.123456789");
});

test("every statement of a multi-account report is parsed", () => {
  const xml = `<FlexQueryResponse><FlexStatements>
    <FlexStatement accountId="U1"><OpenPositions><OpenPosition symbol="A"/></OpenPositions></FlexStatement>
    <FlexStatement accountId="U2"><OpenPositions><OpenPosition symbol="B"/></OpenPositions></FlexStatement>
  </FlexStatements></FlexQueryResponse>`;
  const { statements } = parseQuery(xml);
  assert.deepEqual(statements.map((s) => s.account), ["U1", "U2"]);
});

test("throws on a payload without FlexQueryResponse", () => {
  assert.throws(() => parseQuery("<html>error</html>"), /FlexQueryResponse/);
});
