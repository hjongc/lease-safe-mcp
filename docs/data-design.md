# Lease Safe Data Design

## Automatic Public APIs

1. 행정안전부_행정표준코드_법정동코드
   - Portal: https://www.data.go.kr/data/15077871/openapi.do
   - Endpoint: http://apis.data.go.kr/1741000/StanReginCd/getStanReginCdList
   - Purpose: resolve user region text into legal-dong code records.
   - Required query: `ServiceKey`, `pageNo`, `numOfRows`, `type=json`, `locatadd_nm`.
   - Key fields: `region_cd`, `sido_cd`, `sgg_cd`, `umd_cd`, `locatadd_nm`.

2. 국토교통부 전월세 실거래가 APIs
   - Apartment: https://www.data.go.kr/data/15126474/openapi.do
   - Row house/multifamily: https://www.data.go.kr/data/15126473/openapi.do
   - Single/multifamily detached: https://www.data.go.kr/data/15126472/openapi.do
   - Officetel: https://www.data.go.kr/data/15126475/openapi.do
   - Required query: `LAWD_CD`, `DEAL_YMD`, `serviceKey`.
   - Key fields: `deposit`, `monthlyRent`, `dealYear`, `dealMonth`, `dealDay`, `excluUseAr`, `contractTerm`, `contractType`.

3. 국토교통부 매매 실거래가 APIs
   - Apartment: https://www.data.go.kr/data/15126469/openapi.do
   - Row house/multifamily: https://www.data.go.kr/data/15126467/openapi.do
   - Single/multifamily detached: https://www.data.go.kr/data/15126465/openapi.do
   - Officetel: https://www.data.go.kr/data/15126464/openapi.do
   - Required query: `LAWD_CD`, `DEAL_YMD`, `serviceKey`.
   - Key fields: `dealAmount`, `dealYear`, `dealMonth`, `dealDay`, `excluUseAr`, `totalArea`.

## Curated Official Guidance

These are stored as reviewed source records and rule text, not scraped live at answer time.

- 정부24: move-in report and public service entry point.
- RTMS: housing lease contract reporting.
- 인터넷등기소: fixed date and registry-document confirmation path.
- 찾기쉬운 생활법령 and 국가법령정보센터: legal concepts such as opposition power and preferential payment.
- 한국부동산원·LH 임대차분쟁조정위원회: dispute prevention, standard contract, mediation, and consultation path.
- HUG: deposit-return guarantee confirmation path.

## Boundary

The MCP does not:

- access private registry documents
- submit Government24 civil applications
- determine legal safety
- guarantee HUG insurance eligibility
- recommend property listings
- use broker blogs or private reviews as authority
- replace failed public-data API calls with hardcoded sample data
