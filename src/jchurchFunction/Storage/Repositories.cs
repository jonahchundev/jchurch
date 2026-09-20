using JChurch.Domain;

namespace JChurch.Storage;

public sealed class Repositories(
    IRepository<Church> churches,
    IRepository<Group> groups,
    IRepository<Member> members,
    IRepository<CustomField> fields,
    IRepository<ChurchEvent> events,
    IRepository<Occurrence> occurrences,
    IRepository<Attendance> attendance)
{
    public IRepository<Church> Churches { get; } = churches;
    public IRepository<Group> Groups { get; } = groups;
    public IRepository<Member> Members { get; } = members;
    public IRepository<CustomField> Fields { get; } = fields;
    public IRepository<ChurchEvent> Events { get; } = events;
    public IRepository<Occurrence> Occurrences { get; } = occurrences;
    public IRepository<Attendance> Attendance { get; } = attendance;

    public IRepository<T> For<T>() where T : Document => (IRepository<T>)(object)(typeof(T).Name switch
    {
        nameof(Church) => (object)Churches,
        nameof(Group) => Groups,
        nameof(Member) => Members,
        nameof(CustomField) => Fields,
        nameof(ChurchEvent) => Events,
        nameof(Occurrence) => Occurrences,
        nameof(Attendance) => Attendance,
        _ => throw new InvalidOperationException("Unknown document type.")
    });
}