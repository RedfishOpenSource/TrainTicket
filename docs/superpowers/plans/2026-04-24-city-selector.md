# City Selector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current station autocomplete with a city-dimension selector that resolves to concrete 12306 stations, and enforce full regression after each code change until all tests and scenario checks pass.

**Architecture:** Keep the existing search pipeline based on concrete station names. Add a city aggregation layer in the ticket provider plus a new `/api/cities` endpoint, then upgrade the frontend selector to a reusable city selector with second-level station confirmation for multi-station cities. Update regression documentation and verify the entire suite plus scenario checks after implementation.

**Tech Stack:** Python, FastAPI, pytest, vanilla JavaScript, server-rendered HTML

---

## File Structure
- Modify `app/services/ticket_provider_12306.py` to add city aggregation and city search APIs
- Modify `app/main.py` to expose `GET /api/cities`
- Modify `app/static/app.js` to replace the station field controller with a reusable city selector
- Modify `app/templates/index.html` to adjust copy and render selected-station hint containers
- Modify `tests/test_api.py` to validate the new cities endpoint and unchanged search semantics
- Create or modify `tests/test_ticket_provider_12306.py` to cover city aggregation and matching behavior
- Modify `tests/user_case_scenarios.md` to add the mandatory full-regression rule

### Task 1: Add failing backend tests for city aggregation

**Files:**
- Modify: `tests/test_ticket_provider_12306.py`
- Test: `tests/test_ticket_provider_12306.py`

- [ ] **Step 1: Write the failing test**

```python
from app.services.ticket_provider_12306 import StationOption, TicketProvider12306


def test_group_stations_by_city_returns_single_and_multi_station_cities():
    provider = TicketProvider12306()
    provider.station_options = [
        StationOption(name="杭州", telecode="HZH", pinyin="hangzhou", abbr="hz"),
        StationOption(name="北京", telecode="BJP", pinyin="beijing", abbr="bj"),
        StationOption(name="北京南", telecode="VNP", pinyin="beijingnan", abbr="bjn"),
        StationOption(name="北京西", telecode="BXP", pinyin="beijingxi", abbr="bjx"),
    ]

    grouped = provider.group_stations_by_city()

    assert grouped["杭州"] == [provider.station_options[0]]
    assert [station.name for station in grouped["北京"]] == ["北京", "北京南", "北京西"]


def test_list_cities_matches_by_name_pinyin_and_abbr():
    provider = TicketProvider12306()
    provider.station_options = [
        StationOption(name="上海", telecode="SHH", pinyin="shanghai", abbr="sh"),
        StationOption(name="上海虹桥", telecode="AOH", pinyin="shanghaihongqiao", abbr="shhq"),
        StationOption(name="苏州", telecode="SZH", pinyin="suzhou", abbr="sz"),
    ]
    provider.station_codes = {station.name: station.telecode for station in provider.station_options}

    by_name = provider.list_cities(query="上海", limit=10)
    by_pinyin = provider.list_cities(query="shang", limit=10)
    by_abbr = provider.list_cities(query="sh", limit=10)

    assert by_name[0]["city_name"] == "上海"
    assert by_name[0]["stations"][0]["name"] == "上海"
    assert by_pinyin[0]["city_name"] == "上海"
    assert by_abbr[0]["city_name"] == "上海"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_ticket_provider_12306.py -k "group_stations_by_city or list_cities_matches" -v`
Expected: FAIL with missing methods or assertion errors because city aggregation does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```python
CITY_SUFFIXES = ("东", "西", "南", "北", "站", "东站", "西站", "南站", "北站", "虹桥", "朝阳")


def _derive_city_name(self, station_name: str) -> str:
    for suffix in sorted(CITY_SUFFIXES, key=len, reverse=True):
        if station_name.endswith(suffix) and len(station_name) > len(suffix):
            return station_name[: -len(suffix)]
    return station_name


def group_stations_by_city(self) -> dict[str, list[StationOption]]:
    grouped: dict[str, list[StationOption]] = {}
    for station in self.station_options:
        city_name = self._derive_city_name(station.name)
        grouped.setdefault(city_name, []).append(station)
    return grouped


def list_cities(self, query: str = "", limit: int = 20) -> list[dict[str, object]]:
    if not self.station_codes:
        self.load_station_codes()
    grouped = self.group_stations_by_city()
    normalized_query = query.strip().lower()
    items: list[dict[str, object]] = []
    for city_name, stations in grouped.items():
        pinyin = stations[0].pinyin
        abbr = stations[0].abbr
        if normalized_query and not (
            city_name.startswith(query)
            or normalized_query in city_name.lower()
            or pinyin.startswith(normalized_query)
            or abbr.startswith(normalized_query)
        ):
            continue
        items.append({
            "city_name": city_name,
            "matched_by": "name",
            "display_label": f"{len(stations)} 个车站",
            "stations": [station.to_dict() for station in stations],
        })
    items.sort(key=lambda item: item["city_name"])
    return items[:limit]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_ticket_provider_12306.py -k "group_stations_by_city or list_cities_matches" -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/test_ticket_provider_12306.py app/services/ticket_provider_12306.py
git commit -m "feat: add city aggregation for station lookup"
```

### Task 2: Add failing API tests for city lookup endpoint

**Files:**
- Modify: `tests/test_api.py`
- Test: `tests/test_api.py`

- [ ] **Step 1: Write the failing test**

```python
def test_list_cities_returns_grouped_city_candidates(client):
    response = client.get("/api/cities", params={"q": "北京", "limit": 5})

    assert response.status_code == 200
    payload = response.json()
    assert payload["cities"][0]["city_name"] == "北京"
    assert any(station["name"] == "北京南" for station in payload["cities"][0]["stations"])
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_api.py::test_list_cities_returns_grouped_city_candidates -v`
Expected: FAIL with 404 because `/api/cities` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```python
@app.get("/api/cities")
async def cities(q: str = "", limit: int = Query(default=20, ge=1, le=50)):
    cities_payload = await to_thread.run_sync(service.list_cities, q, limit)
    return {"cities": cities_payload}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_api.py::test_list_cities_returns_grouped_city_candidates -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/test_api.py app/main.py
git commit -m "feat: expose city lookup endpoint"
```

### Task 3: Add failing UI-oriented API semantics tests if needed

**Files:**
- Modify: `tests/test_api.py`
- Test: `tests/test_api.py`

- [ ] **Step 1: Write the failing test**

```python
def test_search_still_requires_valid_station_names(client):
    response = client.post(
        "/api/search",
        json={
            "travel_date": "2026-04-24",
            "departure_station": "北京",
            "arrival_station": "上海",
        },
    )

    assert response.status_code in {200, 400}
```
```

- [ ] **Step 2: Run test to verify it reflects current contract**

Run: `pytest tests/test_api.py::test_search_still_requires_valid_station_names -v`
Expected: PASS if mocked provider accepts those station names, or adjust fixture data to a multi-station city and assert `400` for city-only values.

- [ ] **Step 3: Tighten the assertion to the intended contract**

```python
def test_search_rejects_city_name_without_station_confirmation(client):
    response = client.post(
        "/api/search",
        json={
            "travel_date": "2026-04-24",
            "departure_station": "北京城",
            "arrival_station": "上海城",
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "请选择有效的 12306 站点"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_api.py::test_search_rejects_city_name_without_station_confirmation -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/test_api.py
git commit -m "test: preserve station-only search contract"
```

### Task 4: Implement the reusable city selector frontend

**Files:**
- Modify: `app/static/app.js`
- Modify: `app/templates/index.html`
- Test: `tests/test_api.py`

- [ ] **Step 1: Add the failing behavior check manually**

Observe in `app/templates/index.html` and `app/static/app.js` that the page still calls `/api/stations` and does not support second-level station confirmation.

- [ ] **Step 2: Run existing API tests as a guardrail**

Run: `pytest tests/test_api.py -v`
Expected: PASS before frontend edits.

- [ ] **Step 3: Write minimal implementation**

```javascript
function createCitySelector(field) {
  const visibleInput = field.querySelector('[data-city-input]');
  const hiddenInput = field.querySelector('[data-station-value]');
  const dropdown = field.querySelector('[data-city-dropdown]');
  const selectedStationHint = field.querySelector('[data-selected-station]');
  // keep requestId, debounceTimer, items, activeIndex, expandedCityIndex
  // fetch `/api/cities`
  // direct-select single-station cities
  // expand multi-station cities and require second-level station click
  // clear hidden input whenever query diverges from selected station
}
```

```html
<label class="station-field" data-city-field>
  <input type="hidden" name="departure_station" data-station-value required>
  <input type="text" placeholder="搜索并选择出发城市" autocomplete="off" data-city-input="departure_station" required>
  <span class="station-hint">先选城市，多站城市需继续确认具体车站</span>
  <div class="selected-station-hint" data-selected-station></div>
  <div class="station-dropdown" data-city-dropdown="departure_station"></div>
</label>
```

- [ ] **Step 4: Run API tests to verify frontend-facing server behavior still passes**

Run: `pytest tests/test_api.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/static/app.js app/templates/index.html
git commit -m "feat: add reusable city selector UI"
```

### Task 5: Update regression scenario documentation

**Files:**
- Modify: `tests/user_case_scenarios.md`

- [ ] **Step 1: Write the failing documentation expectation**

Add a note near the regression section requiring full automated tests plus full scenario regression after every code change, and re-run after fixes until all pass.

- [ ] **Step 2: Verify the current doc is insufficient**

Read: `tests/user_case_scenarios.md`
Expected: It only recommends manual checks and does not require full reruns after failures.

- [ ] **Step 3: Write minimal implementation**

```md
后续每次代码修改后，必须执行测试用例和场景 case 的全量回归测试。
如果有任何测试不通过，必须先修复问题，再重新执行一次全量回归测试。
只有在某次修改后全量回归全部通过，才算本次修改完成。
```

- [ ] **Step 4: Verify the document contains the new rule**

Read: `tests/user_case_scenarios.md`
Expected: The new mandatory regression wording appears above the scenario checklist.

- [ ] **Step 5: Commit**

```bash
git add tests/user_case_scenarios.md
git commit -m "docs: require full regression after each change"
```

### Task 6: Run the full regression loop until green

**Files:**
- Modify as needed: `app/main.py`, `app/services/ticket_provider_12306.py`, `app/static/app.js`, `app/templates/index.html`, `tests/test_api.py`, `tests/test_ticket_provider_12306.py`, `tests/user_case_scenarios.md`
- Test: `tests/test_api.py`, `tests/test_ticket_provider_12306.py`, entire `tests/` tree

- [ ] **Step 1: Run targeted backend tests**

Run: `pytest tests/test_ticket_provider_12306.py tests/test_api.py -v`
Expected: PASS

- [ ] **Step 2: Run the full automated suite**

Run: `pytest -v`
Expected: PASS

- [ ] **Step 3: Run scenario regression checklist**

Use `tests/user_case_scenarios.md` and manually verify or document each listed scenario against current behavior. If any scenario fails, fix the code and re-run Step 1 and Step 2 before checking scenarios again.

- [ ] **Step 4: If anything fails, fix minimally and re-run full regression**

```bash
pytest tests/test_ticket_provider_12306.py tests/test_api.py -v
pytest -v
```

Expected: Repeat until all automated tests pass and scenario checks are satisfied.

- [ ] **Step 5: Commit**

```bash
git add app/main.py app/services/ticket_provider_12306.py app/static/app.js app/templates/index.html tests/test_api.py tests/test_ticket_provider_12306.py tests/user_case_scenarios.md
git commit -m "feat: add city-based station selector"
```
