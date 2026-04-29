package com.trainticket.app.plugin;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

import android.content.SharedPreferences;

@CapacitorPlugin(name = "TicketBridge")
public class TicketBridgePlugin extends Plugin {
    private static final String USER_AGENT = "Mozilla/5.0";
    private static final String INIT_URL = "https://kyfw.12306.cn/otn/leftTicket/init?linktypeid=dc";
    private static final String LEFT_TICKET_URL = "https://kyfw.12306.cn/otn/leftTicket/queryG";
    private static final String ROUTE_URL = "https://kyfw.12306.cn/otn/czxx/queryByTrainNo";
    private static final String PRICE_URL = "https://kyfw.12306.cn/otn/leftTicket/queryTicketPrice";
    private static final String RETRYABLE_12306_RESPONSE_ERROR = "__12306_retryable_response__";
    private static final String USER_FACING_12306_RESPONSE_ERROR = "12306 暂时未返回可解析的车票数据，请稍后重试";
    private static final int LONG_TRIP_MINUTES = 330;
    private static final long STATION_CACHE_TTL_MILLIS = 24L * 60L * 60L * 1000L;
    private static final String STATION_CACHE_PREFS = "ticket_bridge_station_cache";
    private static final String STATION_CACHE_KEY = "station_cache_payload";
    private static final String STATION_CACHE_UPDATED_AT_KEY = "station_cache_updated_at";
    private static final String SOURCE_TYPE_DIRECT = "direct";
    private static final String SOURCE_TYPE_EXTENDED = "extended";
    private static final String SEAT_CATEGORY_SEAT = "seat";
    private static final String SEAT_CATEGORY_SLEEPER = "sleeper";
    private static final String UNAVAILABLE_COUNT = "--";
    private static final List<SeatDefinition> SEAT_DEFINITIONS = Collections.unmodifiableList(Arrays.asList(
        new SeatDefinition("swz", "商务座", new String[]{"A9", "9"}, true),
        new SeatDefinition("zy", "一等座", new String[]{"M"}, true),
        new SeatDefinition("ze", "二等座", new String[]{"O"}, true),
        new SeatDefinition("yz", "硬座", new String[]{"A1", "1"}, true),
        new SeatDefinition("gr", "高级软卧", new String[]{"A6", "6"}, false),
        new SeatDefinition("rw", "软卧", new String[]{"A4", "4"}, false),
        new SeatDefinition("yw", "硬卧", new String[]{"A3", "3"}, false)
    ));

    private final Map<String, String> cookies = new LinkedHashMap<>();
    private final Object queryLock = new Object();
    private List<StationEntry> stationEntries;

    @PluginMethod
    public void queryRecommendation(PluginCall call) {
        String travelDate = call.getString("travelDate");
        String departureCity = call.getString("departureCity");
        String arrivalCity = call.getString("arrivalCity");

        if (travelDate == null || departureCity == null || arrivalCity == null) {
            call.reject("travelDate, departureCity and arrivalCity are required");
            return;
        }

        new Thread(() -> {
            try {
                JSObject result;
                synchronized (queryLock) {
                    result = runQueryRecommendation(travelDate, departureCity, arrivalCity);
                }
                call.resolve(result);
            } catch (Exception exception) {
                call.reject(exception.getMessage(), exception);
            }
        }).start();
    }

    @PluginMethod
    public void loadStationSnapshot(PluginCall call) {
        new Thread(() -> {
            try {
                StationSnapshot snapshot;
                synchronized (queryLock) {
                    snapshot = readStationSnapshot();
                    if (snapshot.stations.isEmpty() && stationEntries == null) {
                        snapshot = refreshStationSnapshotInternal();
                    } else if (stationEntries == null && !snapshot.stations.isEmpty()) {
                        stationEntries = snapshot.stations;
                    }
                }
                call.resolve(toStationSnapshot(snapshot));
            } catch (Exception exception) {
                call.reject(exception.getMessage(), exception);
            }
        }).start();
    }

    @PluginMethod
    public void refreshStations(PluginCall call) {
        new Thread(() -> {
            try {
                StationSnapshot snapshot;
                synchronized (queryLock) {
                    snapshot = refreshStationSnapshotInternal();
                }
                call.resolve(toStationSnapshot(snapshot));
            } catch (Exception exception) {
                call.reject(exception.getMessage(), exception);
            }
        }).start();
    }

    private JSObject runQueryRecommendation(String travelDate, String departureCity, String arrivalCity) throws Exception {
        StationEntry departureStation = resolveStation(departureCity);
        StationEntry arrivalStation = resolveStation(arrivalCity);

        JSONObject leftTicketResponse = getJson(
            LEFT_TICKET_URL + "?leftTicketDTO.train_date=" + encode(travelDate)
                + "&leftTicketDTO.from_station=" + encode(departureStation.telecode)
                + "&leftTicketDTO.to_station=" + encode(arrivalStation.telecode)
                + "&purpose_codes=ADULT",
            true,
            true
        );

        JSONObject data = leftTicketResponse.getJSONObject("data");
        JSONArray resultRows = data.getJSONArray("result");
        JSONObject stationMapJson = data.getJSONObject("map");
        Map<String, String> stationMap = toStringMap(stationMapJson);

        List<Candidate> candidates = new ArrayList<>();
        for (int index = 0; index < resultRows.length(); index += 1) {
            String row = resultRows.getString(index);
            LeftTicketRow parsedRow = parseLeftTicketRow(row);
            if (!"Y".equals(parsedRow.canWebBuy)) {
                continue;
            }

            JSONObject routeResponse = getJson(
                ROUTE_URL + "?train_no=" + encode(parsedRow.trainNo)
                    + "&from_station_telecode=" + encode(parsedRow.fromStationTelecode)
                    + "&to_station_telecode=" + encode(parsedRow.toStationTelecode)
                    + "&depart_date=" + encode(formatTrainDate(parsedRow.trainDate)),
                false,
                true
            );
            List<RouteStop> routeStops = parseRouteStops(routeResponse.getJSONObject("data").getJSONArray("data"));
            ActualSegment actualSegment = findActualSegment(routeStops, stationMap, parsedRow, departureCity, arrivalCity);
            if (actualSegment == null) {
                continue;
            }

            List<PurchaseSegment> purchaseSegments = createPurchaseSegments(actualSegment.fromIndex, actualSegment.toIndex, routeStops);
            List<StopTimeline> timeline = buildStopTimeline(routeStops);
            for (PurchaseSegment purchaseSegment : purchaseSegments) {
                JSONObject priceResponse = getJson(
                    PRICE_URL + "?train_no=" + encode(parsedRow.trainNo)
                        + "&from_station_no=" + encode(formatStationNo(purchaseSegment.fromIndex))
                        + "&to_station_no=" + encode(formatStationNo(purchaseSegment.toIndex))
                        + "&seat_types=" + encode(selectSeatTypes(timeline, purchaseSegment, parsedRow.seatTypeCandidates))
                        + "&train_date=" + encode(formatTrainDate(parsedRow.trainDate)),
                    true,
                    true
                );
                candidates.addAll(buildCandidates(parsedRow, actualSegment, purchaseSegment, priceResponse.getJSONObject("data")));
            }
        }

        List<Candidate> rankedCandidates = rankCandidates(mergeCandidates(candidates));
        return buildResult(rankedCandidates);
    }

    private synchronized void ensureSession() throws Exception {
        if (!cookies.isEmpty()) {
            return;
        }

        openConnection(INIT_URL, false);
    }

    private JSONObject getJson(String url, boolean ajaxHeaders, boolean retryOnHtml) throws Exception {
        for (int attempt = 0; attempt < 3; attempt += 1) {
            ensureSession();
            HttpURLConnection connection = openConnection(url, ajaxHeaders);
            String responseText = readResponse(connection);
            try {
                String normalizedResponse = stripBom(responseText);
                if (isHtmlDocument(normalizedResponse)) {
                    throw new IOException(RETRYABLE_12306_RESPONSE_ERROR);
                }
                return new JSONObject(normalizedResponse);
            } catch (JSONException | IOException exception) {
                String message = exception.getMessage() == null ? "" : exception.getMessage();
                boolean shouldRetry = retryOnHtml
                    && attempt < 2
                    && RETRYABLE_12306_RESPONSE_ERROR.equals(message);
                resetSession();
                if (!shouldRetry) {
                    if (RETRYABLE_12306_RESPONSE_ERROR.equals(message)) {
                        throw new IOException(USER_FACING_12306_RESPONSE_ERROR);
                    }
                    throw exception;
                }
                Thread.sleep(300L * (attempt + 1));
            }
        }

        throw new IOException(USER_FACING_12306_RESPONSE_ERROR);
    }

    private HttpURLConnection openConnection(String urlValue, boolean ajaxHeaders) throws Exception {
        URL url = new URL(urlValue);
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setRequestMethod("GET");
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(20000);
        connection.setRequestProperty("User-Agent", USER_AGENT);
        if (ajaxHeaders) {
            connection.setRequestProperty("Referer", INIT_URL);
            connection.setRequestProperty("X-Requested-With", "XMLHttpRequest");
            connection.setRequestProperty("Accept", "application/json, text/javascript, */*; q=0.01");
        }
        if (!cookies.isEmpty()) {
            connection.setRequestProperty("Cookie", buildCookieHeader());
        }
        connection.connect();
        updateCookies(connection);
        return connection;
    }

    private void updateCookies(HttpURLConnection connection) {
        Map<String, List<String>> headers = connection.getHeaderFields();
        List<String> setCookies = headers.get("Set-Cookie");
        if (setCookies == null) {
            return;
        }
        for (String cookie : setCookies) {
            String[] segments = cookie.split(";", 2);
            String[] pair = segments[0].split("=", 2);
            if (pair.length == 2) {
                cookies.put(pair[0], pair[1]);
            }
        }
    }

    private String buildCookieHeader() {
        StringBuilder builder = new StringBuilder();
        for (Map.Entry<String, String> entry : cookies.entrySet()) {
            if (builder.length() > 0) {
                builder.append("; ");
            }
            builder.append(entry.getKey()).append("=").append(entry.getValue());
        }
        return builder.toString();
    }

    private void resetSession() {
        cookies.clear();
    }

    private String readResponse(HttpURLConnection connection) throws Exception {
        InputStream inputStream = connection.getResponseCode() >= 400 ? connection.getErrorStream() : connection.getInputStream();
        if (inputStream == null) {
            throw new IOException("Empty response stream");
        }
        StringBuilder builder = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(inputStream, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                builder.append(line);
            }
        }
        return builder.toString();
    }

    private String stripBom(String value) {
        return value.startsWith("﻿") ? value.substring(1) : value;
    }

    private boolean isHtmlDocument(String value) {
        String normalized = value.trim().toLowerCase(Locale.ROOT);
        return normalized.startsWith("<!doctype html") || normalized.startsWith("<html");
    }

    private StationEntry resolveStation(String cityOrStation) throws Exception {
        if (stationEntries == null) {
            stationEntries = readOrRefreshStations();
        }

        String normalizedInput = normalize(cityOrStation);
        String trimmedInput = normalize(stripCitySuffix(cityOrStation));
        for (StationEntry entry : stationEntries) {
            if (normalize(entry.name).equals(normalizedInput)) {
                return entry;
            }
        }
        for (StationEntry entry : stationEntries) {
            if (normalize(entry.cityName).equals(normalizedInput)) {
                return entry;
            }
        }
        if (!trimmedInput.equals(normalizedInput)) {
            for (StationEntry entry : stationEntries) {
                if (normalize(entry.name).equals(trimmedInput)) {
                    return entry;
                }
            }
            for (StationEntry entry : stationEntries) {
                if (normalize(entry.cityName).equals(trimmedInput)) {
                    return entry;
                }
            }
        }
        for (StationEntry entry : stationEntries) {
            if (normalize(entry.name).contains(trimmedInput)) {
                return entry;
            }
        }
        for (StationEntry entry : stationEntries) {
            if (normalize(entry.cityName).contains(trimmedInput)) {
                return entry;
            }
        }
        throw new IOException("No station found for input: " + cityOrStation);
    }

    private List<StationEntry> loadStations() throws Exception {
        HttpURLConnection connection = openConnection("https://kyfw.12306.cn/otn/resources/js/framework/station_name.js", false);
        String script = readResponse(connection);
        int start = script.indexOf("var station_names ='");
        if (start < 0) {
            throw new IOException("Failed to parse station dictionary payload");
        }
        start += "var station_names ='".length();
        int end = script.indexOf("'", start);
        String stationPayload = script.substring(start, end);
        List<StationEntry> entries = new ArrayList<>();
        for (String rawEntry : stationPayload.split("@")) {
            if (rawEntry.isEmpty()) {
                continue;
            }
            String[] parts = rawEntry.split("\\|");
            String shortName = parts.length > 0 ? parts[0] : "";
            String name = parts.length > 1 ? parts[1] : "";
            String telecode = parts.length > 2 ? parts[2] : "";
            String pinyin = parts.length > 3 ? parts[3] : "";
            String abbreviation = parts.length > 4 ? parts[4] : "";
            String cityName = parts.length > 7 && !parts[7].isEmpty() ? parts[7] : name;
            entries.add(new StationEntry(name, telecode, cityName, pinyin, shortName.isEmpty() ? abbreviation : shortName));
        }
        return entries;
    }

    private List<StationEntry> readOrRefreshStations() throws Exception {
        StationSnapshot snapshot = readStationSnapshot();
        if (!snapshot.stations.isEmpty()) {
            if (isStationCacheExpired(snapshot.updatedAt)) {
                try {
                    snapshot = refreshStationSnapshotInternal();
                } catch (Exception ignored) {
                }
            }
            return snapshot.stations;
        }
        return refreshStationSnapshotInternal().stations;
    }

    private StationSnapshot refreshStationSnapshotInternal() throws Exception {
        List<StationEntry> entries = loadStations();
        stationEntries = entries;
        long updatedAt = System.currentTimeMillis();
        writeStationSnapshot(entries, updatedAt);
        return new StationSnapshot(entries, updatedAt, false);
    }

    private StationSnapshot readStationSnapshot() {
        SharedPreferences preferences = getContext().getSharedPreferences(STATION_CACHE_PREFS, android.content.Context.MODE_PRIVATE);
        String rawPayload = preferences.getString(STATION_CACHE_KEY, null);
        long updatedAt = preferences.getLong(STATION_CACHE_UPDATED_AT_KEY, 0L);
        if (rawPayload == null || rawPayload.isEmpty()) {
            return new StationSnapshot(Collections.emptyList(), null, false);
        }

        try {
            JSONArray array = new JSONArray(rawPayload);
            List<StationEntry> entries = new ArrayList<>();
            for (int index = 0; index < array.length(); index += 1) {
                JSONObject station = array.getJSONObject(index);
                entries.add(new StationEntry(
                    station.optString("name", ""),
                    station.optString("telecode", ""),
                    station.optString("cityName", station.optString("name", "")),
                    station.optString("pinyin", ""),
                    station.optString("abbreviation", "")
                ));
            }
            return new StationSnapshot(entries, updatedAt > 0 ? updatedAt : null, true);
        } catch (JSONException ignored) {
            return new StationSnapshot(Collections.emptyList(), null, false);
        }
    }

    private void writeStationSnapshot(List<StationEntry> entries, long updatedAt) throws JSONException {
        JSONArray array = new JSONArray();
        for (StationEntry entry : entries) {
            JSONObject station = new JSONObject();
            station.put("name", entry.name);
            station.put("telecode", entry.telecode);
            station.put("cityName", entry.cityName);
            station.put("pinyin", entry.pinyin);
            station.put("abbreviation", entry.abbreviation);
            array.put(station);
        }

        SharedPreferences preferences = getContext().getSharedPreferences(STATION_CACHE_PREFS, android.content.Context.MODE_PRIVATE);
        preferences.edit()
            .putString(STATION_CACHE_KEY, array.toString())
            .putLong(STATION_CACHE_UPDATED_AT_KEY, updatedAt)
            .apply();
    }

    private boolean isStationCacheExpired(Long updatedAt) {
        return updatedAt == null || System.currentTimeMillis() - updatedAt >= STATION_CACHE_TTL_MILLIS;
    }

    private JSObject toStationSnapshot(StationSnapshot snapshot) {
        JSObject result = new JSObject();
        JSArray stationsArray = new JSArray();
        for (StationEntry entry : snapshot.stations) {
            JSObject station = new JSObject();
            station.put("cityName", entry.cityName);
            station.put("name", entry.name);
            station.put("telecode", entry.telecode);
            station.put("pinyin", entry.pinyin);
            station.put("abbreviation", entry.abbreviation);
            stationsArray.put(station);
        }
        result.put("stations", stationsArray);
        result.put("updatedAt", snapshot.updatedAt);
        result.put("fromCache", snapshot.fromCache);
        return result;
    }

    private LeftTicketRow parseLeftTicketRow(String row) {
        String[] fields = row.split("\\|", -1);
        Map<String, String> seatAvailabilityMap = new HashMap<>();
        seatAvailabilityMap.put("swz", normalizeCountText(getField(fields, 32)));
        seatAvailabilityMap.put("zy", normalizeCountText(getField(fields, 31)));
        seatAvailabilityMap.put("ze", normalizeCountText(getField(fields, 30)));
        seatAvailabilityMap.put("gr", normalizeCountText(getField(fields, 29)));
        seatAvailabilityMap.put("rw", normalizeCountText(getField(fields, 28)));
        seatAvailabilityMap.put("yw", normalizeCountText(getField(fields, 27)));
        seatAvailabilityMap.put("yz", normalizeCountText(getField(fields, 26)));

        List<String> seatTypeCandidates = new ArrayList<>();
        String fallback = getField(fields, 34);
        String primary = getField(fields, 33);
        if (!fallback.isEmpty()) {
            seatTypeCandidates.add(fallback);
        }
        if (!primary.isEmpty()) {
            seatTypeCandidates.add(primary);
        }

        return new LeftTicketRow(
            getField(fields, 2),
            getField(fields, 3),
            getField(fields, 6),
            getField(fields, 7),
            getField(fields, 11),
            getField(fields, 13),
            seatAvailabilityMap,
            seatTypeCandidates
        );
    }

    private List<RouteStop> parseRouteStops(JSONArray routeData) throws Exception {
        List<RouteStop> stops = new ArrayList<>();
        for (int index = 0; index < routeData.length(); index += 1) {
            JSONObject stop = routeData.getJSONObject(index);
            String stationName = stop.getString("station_name");
            stops.add(new RouteStop(
                stationName,
                stop.optString("arrive_time", "----"),
                stop.optString("start_time", "----")
            ));
        }
        return stops;
    }

    private ActualSegment findActualSegment(
        List<RouteStop> routeStops,
        Map<String, String> stationMap,
        LeftTicketRow row,
        String departureCity,
        String arrivalCity
    ) {
        String departureStationName = stationMap.getOrDefault(row.fromStationTelecode, departureCity);
        String arrivalStationName = stationMap.getOrDefault(row.toStationTelecode, arrivalCity);
        int fromIndex = -1;
        int toIndex = -1;
        for (int index = 0; index < routeStops.size(); index += 1) {
            if (routeStops.get(index).stationName.equals(departureStationName)) {
                fromIndex = index;
            }
            if (routeStops.get(index).stationName.equals(arrivalStationName)) {
                toIndex = index;
            }
        }
        if (fromIndex < 0 || toIndex < 0 || fromIndex >= toIndex) {
            return null;
        }

        List<StopTimeline> timeline = buildStopTimeline(routeStops);
        int durationMinutes = timeline.get(toIndex).arriveMinutes - timeline.get(fromIndex).departMinutes;
        return new ActualSegment(routeStops.get(fromIndex), routeStops.get(toIndex), fromIndex, toIndex, durationMinutes);
    }

    private List<PurchaseSegment> createPurchaseSegments(int fromIndex, int toIndex, List<RouteStop> routeStops) {
        List<PurchaseSegment> segments = new ArrayList<>();
        for (int left = 0; left <= fromIndex; left += 1) {
            for (int right = toIndex; right < routeStops.size(); right += 1) {
                if (left < right) {
                    segments.add(new PurchaseSegment(routeStops.get(left), routeStops.get(right), left, right));
                }
            }
        }
        return segments;
    }

    private List<StopTimeline> buildStopTimeline(List<RouteStop> routeStops) {
        List<StopTimeline> timeline = new ArrayList<>();
        int dayOffset = 0;
        int previousMinute = 0;
        for (int index = 0; index < routeStops.size(); index += 1) {
            RouteStop stop = routeStops.get(index);
            int arriveBase = "----".equals(stop.arriveTime) ? previousMinute : parseClock(stop.arriveTime);
            int departBase = "----".equals(stop.departTime) ? arriveBase : parseClock(stop.departTime);
            if (index == 0) {
                timeline.add(new StopTimeline(arriveBase, departBase));
                previousMinute = departBase;
                continue;
            }
            int arrive = arriveBase + dayOffset * 1440;
            while (arrive < previousMinute) {
                dayOffset += 1;
                arrive = arriveBase + dayOffset * 1440;
            }
            int depart = departBase + dayOffset * 1440;
            while (depart < arrive) {
                depart += 1440;
            }
            timeline.add(new StopTimeline(arrive, depart));
            previousMinute = depart;
        }
        return timeline;
    }

    private List<Candidate> buildCandidates(
        LeftTicketRow row,
        ActualSegment actualSegment,
        PurchaseSegment purchaseSegment,
        JSONObject priceData
    ) {
        List<Candidate> candidates = new ArrayList<>();
        addCheapestCandidate(candidates, row, actualSegment, purchaseSegment, priceData, true);
        addCheapestCandidate(candidates, row, actualSegment, purchaseSegment, priceData, false);
        return candidates;
    }

    private void addCheapestCandidate(
        List<Candidate> candidates,
        LeftTicketRow row,
        ActualSegment actualSegment,
        PurchaseSegment purchaseSegment,
        JSONObject priceData,
        boolean seatCategory
    ) {
        Candidate cheapest = null;
        for (SeatDefinition definition : SEAT_DEFINITIONS) {
            if (definition.isSeat != seatCategory) {
                continue;
            }
            String countText = row.seatAvailabilityMap.getOrDefault(definition.key, UNAVAILABLE_COUNT);
            if (!hasAvailability(countText)) {
                continue;
            }
            Double price = readPrice(priceData, definition.priceKeys);
            if (price == null) {
                continue;
            }
            Candidate candidate = buildCandidate(actualSegment, purchaseSegment, row.trainNo, row.trainCode, definition, price);
            if (cheapest == null || candidate.price < cheapest.price) {
                cheapest = candidate;
            }
        }
        if (cheapest != null) {
            candidates.add(cheapest);
        }
    }

    private Candidate buildCandidate(
        ActualSegment actualSegment,
        PurchaseSegment purchaseSegment,
        String trainNo,
        String trainCode,
        SeatDefinition seatDefinition,
        double price
    ) {
        boolean direct = actualSegment.fromIndex == purchaseSegment.fromIndex
            && actualSegment.toIndex == purchaseSegment.toIndex;
        boolean longTrip = actualSegment.durationMinutes > LONG_TRIP_MINUTES;
        String seatCategory = seatDefinition.isSeat ? SEAT_CATEGORY_SEAT : SEAT_CATEGORY_SLEEPER;
        String sourceType = direct ? SOURCE_TYPE_DIRECT : SOURCE_TYPE_EXTENDED;

        return new Candidate(
            trainNo,
            trainCode,
            actualSegment.fromStop.stationName,
            actualSegment.toStop.stationName,
            purchaseSegment.fromStop.stationName,
            purchaseSegment.toStop.stationName,
            actualSegment.durationMinutes,
            actualSegment.fromStop.departTime,
            actualSegment.toStop.arriveTime,
            seatCategory,
            seatDefinition.label,
            price,
            sourceType,
            purchaseSegment.toIndex - purchaseSegment.fromIndex,
            longTrip,
            buildRecommendationReason(longTrip, seatDefinition.isSeat, direct)
        );
    }

    private List<Candidate> mergeCandidates(List<Candidate> candidates) {
        Map<String, Candidate> merged = new LinkedHashMap<>();
        for (Candidate candidate : candidates) {
            String key = candidate.trainNo + "|" + candidate.actualFrom + "|" + candidate.actualTo + "|" + candidate.seatCategory;
            Candidate current = merged.get(key);
            if (current == null || compareMergePriority(candidate, current) < 0) {
                merged.put(key, candidate);
            }
        }
        return new ArrayList<>(merged.values());
    }

    private List<Candidate> rankCandidates(List<Candidate> candidates) {
        candidates.sort((left, right) -> {
            if (left.isLongTrip != right.isLongTrip) {
                return left.isLongTrip ? 1 : -1;
            }
            if (!left.isLongTrip) {
                return compareShortTrip(left, right);
            }
            return compareLongTrip(left, right);
        });
        return candidates;
    }

    private JSObject buildResult(List<Candidate> rankedCandidates) {
        JSObject result = new JSObject();
        result.put("bestOption", rankedCandidates.isEmpty() ? null : rankedCandidates.get(0).toJsObject());
        JSArray array = new JSArray();
        for (Candidate candidate : rankedCandidates) {
            array.put(candidate.toJsObject());
        }
        result.put("candidates", array);
        return result;
    }

    private int compareMergePriority(Candidate left, Candidate right) {
        if (left.price != right.price) {
            return Double.compare(left.price, right.price);
        }
        if (!left.sourceType.equals(right.sourceType)) {
            return SOURCE_TYPE_DIRECT.equals(left.sourceType) ? -1 : 1;
        }
        if (left.purchaseStopCount != right.purchaseStopCount) {
            return Integer.compare(left.purchaseStopCount, right.purchaseStopCount);
        }
        return left.departureTime.compareTo(right.departureTime);
    }

    private int compareShortTrip(Candidate left, Candidate right) {
        if (left.price != right.price) {
            return Double.compare(left.price, right.price);
        }
        if (!left.sourceType.equals(right.sourceType)) {
            return SOURCE_TYPE_DIRECT.equals(left.sourceType) ? -1 : 1;
        }
        if (left.actualRideDurationMinutes != right.actualRideDurationMinutes) {
            return Integer.compare(left.actualRideDurationMinutes, right.actualRideDurationMinutes);
        }
        return left.departureTime.compareTo(right.departureTime);
    }

    private int compareLongTrip(Candidate left, Candidate right) {
        if (!left.seatCategory.equals(right.seatCategory)) {
            return SEAT_CATEGORY_SLEEPER.equals(left.seatCategory) ? -1 : 1;
        }
        if (left.actualRideDurationMinutes != right.actualRideDurationMinutes) {
            return Integer.compare(left.actualRideDurationMinutes, right.actualRideDurationMinutes);
        }
        if (!left.sourceType.equals(right.sourceType)) {
            return SOURCE_TYPE_DIRECT.equals(left.sourceType) ? -1 : 1;
        }
        if (!left.departureTime.equals(right.departureTime)) {
            return left.departureTime.compareTo(right.departureTime);
        }
        return Double.compare(left.price, right.price);
    }

    private Double readPrice(JSONObject priceData, String[] priceKeys) {
        for (String key : priceKeys) {
            String raw = priceData.optString(key, null);
            if (raw == null || raw.isEmpty()) {
                continue;
            }
            try {
                return Double.parseDouble(raw.replace("¥", ""));
            } catch (NumberFormatException ignored) {
            }
        }
        return null;
    }

    private boolean hasAvailability(String value) {
        return value != null && !value.isEmpty() && !UNAVAILABLE_COUNT.equals(value) && !"无".equals(value) && !"0".equals(value);
    }

    private String normalizeCountText(String value) {
        return value == null ? "" : value.replace("|", "").trim();
    }

    private String selectSeatTypes(List<StopTimeline> timeline, PurchaseSegment purchaseSegment, List<String> seatTypeCandidates) {
        if (!seatTypeCandidates.isEmpty()) {
            return seatTypeCandidates.get(0);
        }

        int durationMinutes = timeline.get(purchaseSegment.toIndex).arriveMinutes - timeline.get(purchaseSegment.fromIndex).departMinutes;
        return durationMinutes > LONG_TRIP_MINUTES ? "MO31" : "9MO";
    }

    private String buildRecommendationReason(boolean longTrip, boolean seat, boolean direct) {
        if (!longTrip) {
            return direct ? "短途优先且价格更低，直达更省心" : "短途优先且价格更低，买长坐短更划算";
        }
        if (!seat) {
            return direct ? "长途优先卧铺，直达乘坐更舒适" : "长途优先卧铺，买长坐短可保留舒适性";
        }
        return direct ? "长途仅剩坐席时优先直达方案" : "长途仅剩坐席时保留可行的买长坐短方案";
    }

    private String getField(String[] fields, int index) {
        return index < fields.length ? fields[index] : "";
    }

    private String formatTrainDate(String trainDate) {
        return trainDate.substring(0, 4) + "-" + trainDate.substring(4, 6) + "-" + trainDate.substring(6, 8);
    }

    private String formatStationNo(int index) {
        return String.format(Locale.US, "%02d", index + 1);
    }

    private int parseClock(String value) {
        String[] parts = value.split(":");
        return Integer.parseInt(parts[0]) * 60 + Integer.parseInt(parts[1]);
    }

    private String normalize(String value) {
        return value.replaceAll("\\s+", "").toLowerCase(Locale.ROOT);
    }

    private String stripCitySuffix(String value) {
        return value.replaceAll("[市县区盟州旗乡镇村]$", "");
    }

    private String encode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }

    private Map<String, String> toStringMap(JSONObject object) throws JSONException {
        Map<String, String> map = new HashMap<>();
        JSONArray names = object.names();
        if (names == null) {
            return map;
        }
        for (int index = 0; index < names.length(); index += 1) {
            String key = names.getString(index);
            map.put(key, object.getString(key));
        }
        return map;
    }

    private static class StationEntry {
        final String name;
        final String telecode;
        final String cityName;
        final String pinyin;
        final String abbreviation;

        StationEntry(String name, String telecode, String cityName, String pinyin, String abbreviation) {
            this.name = name;
            this.telecode = telecode;
            this.cityName = cityName;
            this.pinyin = pinyin;
            this.abbreviation = abbreviation;
        }
    }

    private static class StationSnapshot {
        final List<StationEntry> stations;
        final Long updatedAt;
        final boolean fromCache;

        StationSnapshot(List<StationEntry> stations, Long updatedAt, boolean fromCache) {
            this.stations = stations;
            this.updatedAt = updatedAt;
            this.fromCache = fromCache;
        }
    }

    private static class RouteStop {
        final String stationName;
        final String arriveTime;
        final String departTime;

        RouteStop(String stationName, String arriveTime, String departTime) {
            this.stationName = stationName;
            this.arriveTime = arriveTime;
            this.departTime = departTime;
        }
    }

    private static class StopTimeline {
        final int arriveMinutes;
        final int departMinutes;

        StopTimeline(int arriveMinutes, int departMinutes) {
            this.arriveMinutes = arriveMinutes;
            this.departMinutes = departMinutes;
        }
    }

    private static class PurchaseSegment {
        final RouteStop fromStop;
        final RouteStop toStop;
        final int fromIndex;
        final int toIndex;

        PurchaseSegment(RouteStop fromStop, RouteStop toStop, int fromIndex, int toIndex) {
            this.fromStop = fromStop;
            this.toStop = toStop;
            this.fromIndex = fromIndex;
            this.toIndex = toIndex;
        }
    }

    private static class ActualSegment {
        final RouteStop fromStop;
        final RouteStop toStop;
        final int fromIndex;
        final int toIndex;
        final int durationMinutes;

        ActualSegment(RouteStop fromStop, RouteStop toStop, int fromIndex, int toIndex, int durationMinutes) {
            this.fromStop = fromStop;
            this.toStop = toStop;
            this.fromIndex = fromIndex;
            this.toIndex = toIndex;
            this.durationMinutes = durationMinutes;
        }
    }

    private static class SeatDefinition {
        final String key;
        final String label;
        final String[] priceKeys;
        final boolean isSeat;

        SeatDefinition(String key, String label, String[] priceKeys, boolean isSeat) {
            this.key = key;
            this.label = label;
            this.priceKeys = priceKeys;
            this.isSeat = isSeat;
        }
    }

    private static class LeftTicketRow {
        final String trainNo;
        final String trainCode;
        final String fromStationTelecode;
        final String toStationTelecode;
        final String canWebBuy;
        final String trainDate;
        final Map<String, String> seatAvailabilityMap;
        final List<String> seatTypeCandidates;

        LeftTicketRow(
            String trainNo,
            String trainCode,
            String fromStationTelecode,
            String toStationTelecode,
            String canWebBuy,
            String trainDate,
            Map<String, String> seatAvailabilityMap,
            List<String> seatTypeCandidates
        ) {
            this.trainNo = trainNo;
            this.trainCode = trainCode;
            this.fromStationTelecode = fromStationTelecode;
            this.toStationTelecode = toStationTelecode;
            this.canWebBuy = canWebBuy;
            this.trainDate = trainDate;
            this.seatAvailabilityMap = seatAvailabilityMap;
            this.seatTypeCandidates = seatTypeCandidates;
        }
    }

    private static class Candidate {
        final String trainNo;
        final String trainCode;
        final String actualFrom;
        final String actualTo;
        final String purchaseFrom;
        final String purchaseTo;
        final int actualRideDurationMinutes;
        final String departureTime;
        final String arrivalTime;
        final String seatCategory;
        final String seatLabel;
        final double price;
        final String sourceType;
        final int purchaseStopCount;
        final boolean isLongTrip;
        final String recommendationReason;

        Candidate(
            String trainNo,
            String trainCode,
            String actualFrom,
            String actualTo,
            String purchaseFrom,
            String purchaseTo,
            int actualRideDurationMinutes,
            String departureTime,
            String arrivalTime,
            String seatCategory,
            String seatLabel,
            double price,
            String sourceType,
            int purchaseStopCount,
            boolean isLongTrip,
            String recommendationReason
        ) {
            this.trainNo = trainNo;
            this.trainCode = trainCode;
            this.actualFrom = actualFrom;
            this.actualTo = actualTo;
            this.purchaseFrom = purchaseFrom;
            this.purchaseTo = purchaseTo;
            this.actualRideDurationMinutes = actualRideDurationMinutes;
            this.departureTime = departureTime;
            this.arrivalTime = arrivalTime;
            this.seatCategory = seatCategory;
            this.seatLabel = seatLabel;
            this.price = price;
            this.sourceType = sourceType;
            this.purchaseStopCount = purchaseStopCount;
            this.isLongTrip = isLongTrip;
            this.recommendationReason = recommendationReason;
        }

        JSObject toJsObject() {
            JSObject object = new JSObject();
            object.put("trainNo", trainNo);
            object.put("trainCode", trainCode);
            object.put("actualFrom", actualFrom);
            object.put("actualTo", actualTo);
            object.put("purchaseFrom", purchaseFrom);
            object.put("purchaseTo", purchaseTo);
            object.put("actualRideDurationMinutes", actualRideDurationMinutes);
            object.put("departureTime", departureTime);
            object.put("arrivalTime", arrivalTime);
            object.put("seatCategory", seatCategory);
            object.put("seatLabel", seatLabel);
            object.put("price", price);
            object.put("sourceType", sourceType);
            object.put("purchaseStopCount", purchaseStopCount);
            object.put("isLongTrip", isLongTrip);
            object.put("recommendationReason", recommendationReason);
            return object;
        }

    }
}
