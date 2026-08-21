/// Typed portable Text equality for generated Agent Flow lowerings.
pub fn textEqual(flow: anytype, left: anytype, right: @TypeOf(left)) @TypeOf(flow.compareEqZero(flow.textCompare(left, right))) {
    return flow.compareEqZero(flow.textCompare(left, right));
}

/// Portable zero and one constants from Agent's standard lowering context.
pub fn zero(flow: anytype, comptime T: type, comptime context: anytype) @TypeOf(flow.constant(T, context.zero_index)) {
    return flow.constant(T, context.zero_index);
}

pub fn one(flow: anytype, comptime T: type, comptime context: anytype) @TypeOf(flow.constant(T, context.one_index)) {
    return flow.constant(T, context.one_index);
}

pub fn boolean(flow: anytype, value: bool, comptime context: anytype) @TypeOf(flow.constant(bool, context.false_index)) {
    return flow.constant(bool, if (value) context.true_index else context.false_index);
}

pub fn increment(flow: anytype, value: anytype, comptime T: type, comptime context: anytype) @TypeOf(value) {
    return flow.integerAdd(value, one(flow, T, context));
}

pub fn replaceProductField(flow: anytype, product: anytype, comptime field_index: u16, replacement: anytype) @TypeOf(product) {
    return flow.productReplace(field_index, product, replacement);
}

/// Upsert a product element in a bounded portable Vector by one text or integer key.
pub fn upsertProductKey(
    flow: anytype,
    comptime Vector: type,
    values: anytype,
    item: anytype,
    comptime key_index: u16,
    comptime text_key: bool,
    comptime context: anytype,
) @TypeOf(values) {
    const head = flow.block(.loop_header, .{ u32, Vector });
    const inspect = flow.block(.segment, .{ u32, Vector });
    const found = flow.block(.segment, .{Vector});
    const append = flow.block(.segment, .{Vector});
    const done = flow.block(.segment, .{Vector});
    flow.jump(head, .{ zero(flow, u32, context), values });
    const h = flow.enter(head);
    flow.branch(
        flow.integerGreaterEqual(h[0], flow.vectorLength(h[1])),
        append,
        .{h[1]},
        inspect,
        .{ h[0], h[1] },
    );
    const i = flow.enter(inspect);
    const old_key = flow.productExtract(key_index, flow.vectorGet(i[1], i[0]));
    const new_key = flow.productExtract(key_index, item);
    const equal = if (text_key)
        textEqual(flow, old_key, new_key)
    else
        flow.integerEqual(old_key, new_key);
    flow.branch(
        equal,
        found,
        .{flow.vectorSet(i[1], i[0], item)},
        head,
        .{ increment(flow, i[0], u32, context), i[1] },
    );
    const existing = flow.enter(found);
    flow.jump(done, .{existing[0]});
    const missing = flow.enter(append);
    flow.jump(done, .{flow.vectorPush(missing[0], item)});
    return flow.enter(done)[0];
}

/// Decide whether any product element in a bounded Vector has one exact Text field.
pub fn vectorContainsTextField(
    flow: anytype,
    values: anytype,
    comptime field_index: u16,
    expected: anytype,
    comptime context: anytype,
) @TypeOf(boolean(flow, false, context)) {
    const head = flow.block(.loop_header, .{u32});
    const inspect = flow.block(.segment, .{u32});
    const done = flow.block(.segment, .{bool});
    flow.jump(head, .{zero(flow, u32, context)});
    const h = flow.enter(head);
    flow.branch(
        flow.integerGreaterEqual(h[0], flow.vectorLength(values)),
        done,
        .{boolean(flow, false, context)},
        inspect,
        .{h[0]},
    );
    const index = flow.enter(inspect)[0];
    const item = flow.vectorGet(values, index);
    flow.branch(
        textEqual(flow, flow.productExtract(field_index, item), expected),
        done,
        .{boolean(flow, true, context)},
        head,
        .{increment(flow, index, u32, context)},
    );
    return flow.enter(done)[0];
}

/// Decide whether any product element has two exact Text fields.
pub fn vectorContainsTextPair(
    flow: anytype,
    values: anytype,
    comptime first_index: u16,
    first_expected: anytype,
    comptime second_index: u16,
    second_expected: anytype,
    comptime context: anytype,
) @TypeOf(boolean(flow, false, context)) {
    const head = flow.block(.loop_header, .{u32});
    const inspect = flow.block(.segment, .{u32});
    const done = flow.block(.segment, .{bool});
    flow.jump(head, .{zero(flow, u32, context)});
    const h = flow.enter(head);
    flow.branch(
        flow.integerGreaterEqual(h[0], flow.vectorLength(values)),
        done,
        .{boolean(flow, false, context)},
        inspect,
        .{h[0]},
    );
    const index = flow.enter(inspect)[0];
    const item = flow.vectorGet(values, index);
    const first_equal = textEqual(flow, flow.productExtract(first_index, item), first_expected);
    const second_equal = textEqual(flow, flow.productExtract(second_index, item), second_expected);
    flow.branch(
        flow.booleanAnd(first_equal, second_equal),
        done,
        .{boolean(flow, true, context)},
        head,
        .{increment(flow, index, u32, context)},
    );
    return flow.enter(done)[0];
}
