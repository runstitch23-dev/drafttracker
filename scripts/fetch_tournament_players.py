#!/usr/bin/env python3
import json
import pathlib
import time
import urllib.request

SCOREBOARD_URL = (
    "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/"
    "scoreboard?seasontype=3&groups=100&dates=20260317-20260407&limit=1000"
)
ROSTER_URL_TEMPLATE = (
    "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/"
    "teams/{team_id}/roster"
)


def fetch_json(url):
    last_error = None
    for attempt in range(1, 5):
        try:
            request = urllib.request.Request(
                url,
                headers={
                    "User-Agent": "Mozilla/5.0 (Codex Draft Tracker)"
                }
            )
            with urllib.request.urlopen(request, timeout=12) as response:
                return json.load(response)
        except Exception as error:  # noqa: BLE001
            last_error = error
            if attempt < 4:
                time.sleep(0.4 * attempt)
    raise RuntimeError(f"Failed to fetch {url}: {last_error}")


def get_tournament_teams():
    data = fetch_json(SCOREBOARD_URL)
    teams = {}
    for event in data.get("events", []):
        for competition in event.get("competitions", []):
            for competitor in competition.get("competitors", []):
                team = competitor.get("team", {})
                team_id = str(team.get("id", "")).strip()
                if not team_id.isdigit():
                    continue
                teams[team_id] = (
                    team.get("shortDisplayName")
                    or team.get("location")
                    or team.get("displayName")
                    or f"Team {team_id}"
                )
    return teams


def get_roster_players(team_id, team_name):
    url = ROSTER_URL_TEMPLATE.format(team_id=team_id)
    data = fetch_json(url)
    players = []
    for athlete in data.get("athletes", []):
        full_name = (athlete.get("fullName") or "").strip()
        if not full_name:
            continue
        players.append(
            {
                "name": full_name,
                "team": team_name,
                "teamId": team_id,
                "id": str(athlete.get("id", "")).strip()
            }
        )
    return players


def normalize(text):
    return " ".join(text.lower().split())


def main():
    root = pathlib.Path(__file__).resolve().parents[1]
    out_js = root / "tournamentPlayers.js"
    out_json = root / "tournamentPlayers.json"

    teams = get_tournament_teams()
    all_players = []
    sorted_teams = sorted(teams.items(), key=lambda x: x[1].lower())
    for idx, (team_id, team_name) in enumerate(sorted_teams, start=1):
        print(f"[{idx}/{len(sorted_teams)}] {team_name}")
        try:
            all_players.extend(get_roster_players(team_id, team_name))
        except RuntimeError as error:
            print(f"  skipped: {error}")

    deduped = []
    seen = set()
    for player in all_players:
        key = (normalize(player["name"]), normalize(player["team"]))
        if key in seen:
            continue
        seen.add(key)
        deduped.append(player)

    deduped.sort(key=lambda p: (p["team"].lower(), p["name"].lower()))

    payload = {
        "source": "ESPN public site API",
        "season": 2026,
        "teamCount": len(teams),
        "playerCount": len(deduped),
        "players": deduped
    }
    out_json.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    js_players = [{"name": p["name"], "team": p["team"]} for p in deduped]
    out_js.write_text(
        "window.TOURNAMENT_PLAYERS = "
        + json.dumps(js_players, ensure_ascii=False, indent=2)
        + ";\n",
        encoding="utf-8"
    )

    print(f"Teams: {len(teams)}")
    print(f"Players: {len(deduped)}")
    print(f"Wrote: {out_js}")
    print(f"Wrote: {out_json}")


if __name__ == "__main__":
    main()
