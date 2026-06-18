# -*- coding: utf-8 -*-
"""拆分数据存取层（薄壳）

历史兼容：业务逻辑已迁移至 services/filter_service.py。
拆分操作不涉及 JSON 持久化配置，本模块仅保留转发以兼容旧引用。
"""
# pylint: disable=unused-import
from services.filter_service import split_filtered_data  # noqa: F401
