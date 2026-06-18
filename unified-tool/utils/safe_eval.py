# -*- coding: utf-8 -*-
"""安全算术表达式求值器

替代 eval()，仅支持数字与四则运算（+ - * / 一元正负号、括号）。
基于 AST 解析，从语法层面拒绝一切非算术结构
（变量名、属性访问、函数调用、赋值、推导式、位运算等）。
"""
import ast
import operator

_BIN_OPS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
}

_UNARY_OPS = {
    ast.UAdd: operator.pos,
    ast.USub: operator.neg,
}


def safe_eval_arithmetic(expr):
    """安全求值算术表达式。

    Args:
        expr: 形如 "1+2*3" / "(-5.5+2)/4" / "1e-3" 的纯算术字符串。

    Returns:
        int 或 float 计算结果。

    Raises:
        ValueError: 表达式包含不支持的语法（名称、调用、位运算等）。
        SyntaxError: 表达式无法解析。
        ZeroDivisionError: 除零。
    """
    node = ast.parse(str(expr).strip(), mode='eval')
    return _eval(node.body)


def _eval(node):
    if isinstance(node, ast.Constant):
        # bool 是 int 的子类，显式排除，避免 True/False 被当作 1/0
        if isinstance(node.value, bool) or not isinstance(node.value, (int, float)):
            raise ValueError('不支持的常量类型')
        return node.value
    if isinstance(node, ast.BinOp):
        op = _BIN_OPS.get(type(node.op))
        if op is None:
            raise ValueError('不支持的运算符: %s' % type(node.op).__name__)
        return op(_eval(node.left), _eval(node.right))
    if isinstance(node, ast.UnaryOp):
        op = _UNARY_OPS.get(type(node.op))
        if op is None:
            raise ValueError('不支持的一元运算符: %s' % type(node.op).__name__)
        return op(_eval(node.operand))
    raise ValueError('不支持的表达式节点: %s' % type(node).__name__)
