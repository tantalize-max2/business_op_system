# -*- coding: utf-8 -*-
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

DATA_DIR = os.path.join(BASE_DIR, 'data')
UPLOAD_DIR = os.path.join(DATA_DIR, 'uploads')
OUTPUT_DIR = os.path.join(DATA_DIR, 'output')
CONFIGS_DIR = os.path.join(DATA_DIR, 'configs')

MAPPING_FILE = os.path.join(DATA_DIR, 'bureau_mapping.json')
SHEETS_FILE = os.path.join(DATA_DIR, 'kdocs_sheets.json')
TEMPLATES_DIR = os.path.join(DATA_DIR, 'bureau_templates')
NZ_TEMPLATES_DIR = os.path.join(DATA_DIR, 'nz_templates')
KDOCS_CATS_FILE = os.path.join(DATA_DIR, 'kdocs_categories.json')

EMAIL_DATA_DIR = os.path.join(DATA_DIR, 'email')
EMAIL_CONTACTS_FILE = os.path.join(EMAIL_DATA_DIR, 'contacts.json')
EMAIL_TEMPLATES_FILE = os.path.join(EMAIL_DATA_DIR, 'templates.json')
EMAIL_COOKIES_FILE = os.path.join(EMAIL_DATA_DIR, 'cookies.json')
EMAIL_UPLOAD_DIR = os.path.join(EMAIL_DATA_DIR, 'uploads')
EMAIL_LOGIN_CREDS_FILE = os.path.join(EMAIL_DATA_DIR, 'login_creds.json')
TXT_VARS_DIR = os.path.join(EMAIL_DATA_DIR, 'txt_vars')

DEFAULT_MAPPING = {
    "工业能源政企分局": ["朱晨静", "肖智宇", "杜云帆", "屈容", "陈谦", "唐璐", "杜秋宇"],
    "国有平台政企分局": ["付登会", "蓝旭辉", "田小兰", "颜小琳", "易琴", "杨文", "王越"],
    "健康医疗政企分局": ["潘昱忻", "黎明", "先有为", "王虹丹"],
    "金融证券政企分局": ["贺贤珍", "曹岚", "梁曦宇", "杨彭萱", "张静", "郑文", "刘浩林", "杨真", "杨玮萍"],
    "软件科研政企分局": ["雷世豪", "陈燕", "杨璨宇", "李春江", "潘邓浩", "蒋尧莉", "李永婷", "蒲竑佚", "周建龙", "杨楚琪"],
    "新经济政企分局": ["曾理", "韩思萌", "罗维", "罗霞", "杨佩东", "刘文博", "戚新鹏"],
    "政法应急政企分局": ["王万辞", "徐杨", "袁进", "朱林", "袁新博", "张皓秋", "林佳俊", "黄天玉"],
    "政务政企分局": ["薛笑枫", "廖晓东", "钱宇煊", "吴倩", "杜成思", "黄振宇"],
    "高新孵化园智改数转服务局": ["董小凤", "邱国锋", "龙俊儒"],
    "高新天府生命科技园智改数转服务局": ["杨佳", "蒋建国", "王斯祺"],
    "高新天府软件园智改数转服务局": ["谢思宇", "黄微", "李选玉", "朱勇", "谢勇", "何琼", "高欢", "周莉", "李艺"],
    "金融城商客分局": ["姚尧", "王淑惠", "陈伟智", "曾宇嘉", "罗中伟", "张成铭", "刘荣"],
    "新川商客分局": ["靳扬", "姜春阳", "郑黎霞", "杨晋"],
    "天府新谷商客分局": ["李思锐", "彭倩", "黄燕", "刘鹏洋", "刘星月"],
    "新会展商客分局": ["何艳", "樊志林", "周滨", "蒋稚薇"],
    "天府国际商客分局": ["叶江", "蒋天佑", "杨茜", "李巧巧", "王辰雨", "廖华", "曾明全", "巫婷婷"],
    "环球商客分局": ["曾明", "许可", "钟小燕", "肖福洋", "冯麟霞", "王琴丽"],
    "大源商客分局": ["邱浩锋", "冯兰越", "冯特峰", "裴嘉轩", "何亚琪"],
    "肖芳商客分局": ["任登科", "贾小东", "梁润", "陈雪"],
    "府城商客分局": ["陈磊", "李若玉", "张小龙", "孙雯"],
    "连锁商客分局": ["杨凤翥", "肖帆", "赵娇", "高毛茅", "温有军"],
    "西信商客分局": ["杨力", "王宇", "任少杰", "周雨晴", "刘祖源", "胡文瀚", "赵川川"],
    "东苑商客分局": ["雷蕾", "吴文宪", "孙艺丹", "张宇魁", "聂海林", "陈健明"],
    "校园分局": ["薛程月", "李经霜", "阳文婷", "欧阳晨"]
}

INDUSTRY_BUREAUS = [
    "政法应急政企分局", "国有平台政企分局", "金融证券政企分局", "工业能源政企分局",
    "政务政企分局", "高新天府软件园智改数转服务局", "软件科研政企分局",
    "高新孵化园智改数转服务局", "新经济政企分局", "健康医疗政企分局",
    "高新天府生命科技园智改数转服务局"
]

COMMERCIAL_BUREAUS = [
    "校园分局", "新川商客分局", "金融城商客分局", "肖芳商客分局",
    "东苑商客分局", "天府国际商客分局", "大源商客分局", "新会展商客分局",
    "连锁商客分局", "环球商客分局", "天府新谷商客分局", "西信商客分局", "府城商客分局"
]

MAIL_CONFIG = {
    'username': 'wangy592@chinatelecom.cn',
    'password': 'wY0426!..',
    'auth_code': 'nblaelviyhpdegbh',
    'account': 'wangy592',
    'phone': '18081927229',
}


def ensure_dirs():
    for d in [UPLOAD_DIR, OUTPUT_DIR, CONFIGS_DIR, TEMPLATES_DIR, NZ_TEMPLATES_DIR,
              EMAIL_DATA_DIR, EMAIL_UPLOAD_DIR, TXT_VARS_DIR]:
        os.makedirs(d, exist_ok=True)
