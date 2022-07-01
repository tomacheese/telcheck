# coding: utf-8

import csv
import hashlib
import json
import os
import re
import textwrap

import requests
from bs4 import BeautifulSoup

MESSAGE_FORMAT = """
:telephone:__**[{DIR} ({STATUS})] {NUMBER} {FROM}**__
**STARTTIME**: {STARTTIME}
**ENDTIME**: {ENDTIME}
**CONNTIME**: {CONNTIME}

**SOURCE**: {SOURCE}
"""
DATA_DIR = "/data"


def main():
    response = requests.get(
        "http://192.168.0.1/dashboard/hist_cal_data.txt", auth=(os.environ["ROUTER_USER"], os.environ["ROUTER_PASSWORD"]))
    response.encoding = response.apparent_encoding

    if response.status_code == 401:
        response = requests.get(
            "http://192.168.0.1/dashboard/hist_cal_data.txt", auth=(os.environ["ROUTER_USER"], os.environ["ROUTER_PASSWORD"]))
        response.encoding = response.apparent_encoding

    try:
        json = response.json()
    except Exception as e:
        print(e)
        print(response.text)
        exit(1)

    if json["result"] != "SUCCESS":
        exit(1)

    phones = {}
    with open(DATA_DIR + "/phones.tsv", encoding="utf-8", newline="") as f:
        for cols in csv.reader(f, delimiter="\t"):
            phones[cols[1]] = cols[0]

    for one in json["success"]["HISTORY"]:
        STARTTIME = one["STARTTIME"]
        if "ENDTIME" in one.keys():
            ENDTIME = one["ENDTIME"]
        else:
            ENDTIME = "null"
        if "CONNTIME" in one.keys():
            CONNTIME = one["CONNTIME"]
        else:
            CONNTIME = "null"
        DIR = one["DIR"]
        NUMBER = one["NUMBER"]
        if NUMBER.isdecimal() and len(NUMBER) == 7:  # 市外局番なし
            NUMBER = "055" + NUMBER
        STATUS = one["STATUS"]

        if is_checked(STARTTIME, NUMBER, STATUS, DIR):
            continue

        FROM = None
        SOURCE = None
        if "@" in NUMBER:
            FROM = "内線"
            SOURCE = "内線"

        if FROM == None and NUMBER in phones.keys():
            FROM = phones[NUMBER]
            SOURCE = "電話帳"

        if FROM == None:
            FROM = telnavi(NUMBER)
            if FROM != None:
                SOURCE = "電話帳ナビ `telnavi.jp`"

        if FROM == None:
            FROM = jpnumber(NUMBER)
            if FROM != None:
                SOURCE = "電話番号検索 `jpnumber.com`"

        if FROM == None:
            FROM = meiwakucheck(NUMBER)
            if FROM == "？":
                FROM = None
            if FROM != None:
                SOURCE = "電話番号検索＠迷惑電話チェック `https://meiwakucheck.com/`"

        message = MESSAGE_FORMAT.format(DIR=DIR, STATUS=STATUS, NUMBER=NUMBER, FROM=FROM,
                                        STARTTIME=STARTTIME, ENDTIME=ENDTIME, CONNTIME=CONNTIME, SOURCE=SOURCE)
        if DIR == "着信":
            DiscordSend(os.environ["DISCORD_CHANNEL_ID_ONLY_INCOMING"],
                        textwrap.dedent(message).strip()[:1950])
            print(textwrap.dedent(message).strip())
        else:
            DiscordSend(os.environ["DISCORD_CHANNEL_ID"],
                        textwrap.dedent(message).strip()[:1950])
            print(textwrap.dedent(message).strip())

        add_checked(STARTTIME, NUMBER, STATUS, DIR)


def DiscordSend(channel, message):
    headers = {
        "Content-Type": "application/json",
        "Authorization": "Bot " + os.environ["DISCORD_BOT_TOKEN"],
        "User-Agent": "DiscordBot (https://tomacheese.com, v0.0.1)"
    }
    data = {
        "content": message
    }
    response = requests.post("https://discord.com/api/channels/" + channel + "/messages",
                             headers=headers,
                             data=json.dumps(data))
    print(response.status_code)
    print(response.text)


def telnavi(NUMBER):
    html = requests.get("https://www.telnavi.jp/phone/" + NUMBER)
    soup = BeautifulSoup(html.content, "html.parser")
    if re.fullmatch(r"^電話番号[0-9]+は(.+)$", soup.find("title").text):
        return re.sub(r"^電話番号[0-9]+は(.+)$", r"\1", soup.find("title").text)
    else:
        return None


def jpnumber(NUMBER):
    search_html = requests.get(
        "https://www.jpnumber.com/searchnumber.do?number=" + NUMBER)
    search_soup = BeautifulSoup(search_html.content, "html.parser")
    if search_soup.select_one("span[class='number-text15']") == None or search_soup.select_one("span[class='number-text15']").text == 0:
        return None
    phone_url = "https://www.jpnumber.com/" + \
        search_soup.select_one(".title-text12 > .result").get("href")
    phone_html = requests.get(phone_url)
    phone_soup = BeautifulSoup(phone_html.content, "html.parser")
    print(phone_soup.find("title").text)
    if re.match(r"「(.+)」", phone_soup.find("title").text):
        return re.sub(r"^「(.+)」", r"\1", phone_soup.find("title").text)
    else:
        return None


def meiwakucheck(NUMBER):
    html = requests.get("https://meiwakucheck.com/search?tel_no=" + NUMBER)
    soup = BeautifulSoup(html.content, "html.parser")
    print(soup.select_one("table > tr:nth-child(1) > td"))
    if soup.select_one("table > tr:nth-child(1) > td") != None:
        return re.sub(r"^(.+)\[.*$", r"\1", soup.select_one("table > tr:nth-child(1) > td").text)
    else:
        return None


def google_search(NUMBER):
    response = requests.get(
        "https://www.googleapis.com/customsearch/v1?key=" + os.environ["GOOGLE_SEARCH_KEY"] + "&cx=" + os.environ["GOOGLE_SEARCH_CX"] + "&lr=lang_ja&q=" + NUMBER)
    json = response.json()
    count = json["searchInformation"]["formattedTotalResults"]
    message = "**検索結果 - 約 " + count + " 件**\n"
    if "items" in json and len(json["items"]) != 0:
        num = 1
        for one in json["items"]:
            message += "#{NUM} **{TITLE}** {LINK} ```{SNIPPET}```".format(
                NUM=num,
                TITLE=one["title"],
                LINK=one["link"],
                SNIPPET=one["snippet"])
            if num >= 3:
                break
            num += 1

    return message


def is_checked(STARTTIME, NUMBER, STATUS, DIR):
    HASH = hashlib.sha1((STARTTIME + "_" + NUMBER + "_" +
                         STATUS + "_" + DIR).encode('utf-8')).hexdigest()
    if os.path.exists(DATA_DIR + "/check.json"):
        checked = json.load(open(os.path.join(DATA_DIR, "check.json"), "r"))
    else:
        checked = []
    return HASH in checked


def add_checked(STARTTIME, NUMBER, STATUS, DIR):
    HASH = hashlib.sha1((STARTTIME + "_" + NUMBER + "_" +
                         STATUS + "_" + DIR).encode('utf-8')).hexdigest()
    if os.path.exists(DATA_DIR + "/check.json"):
        checked = json.load(open(os.path.join(DATA_DIR, "check.json"), "r"))
    else:
        checked = []
    checked.append(HASH)

    with open(DATA_DIR + "/check.json", 'w') as f:
        json.dump(checked, f)


main()
