/// Typed portable Text equality for generated Agent Flow lowerings.
pub fn textEqual(flow: anytype, left: anytype, right: @TypeOf(left)) @TypeOf(flow.compareEqZero(flow.textCompare(left, right))) {
    return flow.compareEqZero(flow.textCompare(left, right));
}
