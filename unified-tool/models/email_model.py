# -*- coding: utf-8 -*-
"""邮件数据存取层（纯 JSON/文件存取）

业务逻辑（发送、批量发送、登录流程、联系人/模板编排）已迁移至 services/email_service.py。
本模块仅负责 contacts、templates、txt_vars、login_creds、cookies 的持久化。
"""
import os
from config import (EMAIL_CONTACTS_FILE, EMAIL_TEMPLATES_FILE,
                    EMAIL_COOKIES_FILE, EMAIL_LOGIN_CREDS_FILE, TXT_VARS_DIR)
from utils.storage import load_json, save_json


# ========== 联系人 ==========

def load_contacts():
    return load_json(EMAIL_CONTACTS_FILE)


def save_contacts(contacts):
    save_json(EMAIL_CONTACTS_FILE, contacts)


# ========== 邮件模板 ==========

def load_templates():
    return load_json(EMAIL_TEMPLATES_FILE)


def save_templates(templates):
    save_json(EMAIL_TEMPLATES_FILE, templates)


# ========== 登录凭证与会话 ==========

def load_login_creds():
    return load_json(EMAIL_LOGIN_CREDS_FILE, default=None)


def save_login_creds(data):
    save_json(EMAIL_LOGIN_CREDS_FILE, data)


def load_cookies():
    return load_json(EMAIL_COOKIES_FILE, default=None)


def save_cookies(cookies):
    save_json(EMAIL_COOKIES_FILE, cookies)


# ========== TXT 变量文件 ==========

def load_txt_var(name):
    fpath = os.path.join(TXT_VARS_DIR, f'{name}.json')
    return load_json(fpath, default=None)


def save_txt_var(name, data):
    fpath = os.path.join(TXT_VARS_DIR, f'{name}.json')
    save_json(fpath, data)


def delete_txt_var(name):
    fpath = os.path.join(TXT_VARS_DIR, f'{name}.json')
    if os.path.exists(fpath):
        os.remove(fpath)


def list_txt_var_names():
    """列出所有 txt 变量文件名（不含扩展名）。"""
    result = []
    if not os.path.exists(TXT_VARS_DIR):
        return result
    for fname in os.listdir(TXT_VARS_DIR):
        if fname.endswith('.json'):
            result.append(fname[:-5])
    return result
