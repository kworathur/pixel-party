"""
Simple script to create the commands for creating a wide row 
in cassandra, where each column corresponds to a board cell
"""


DIM = 250

with open('alter_command.txt', 'w') as f:
    f.write("ALTER TABLE place.board ADD (")
    for i in range(DIM):
        for j in range(DIM):
            f.write('"({}, {})" text'.format(i, j))
            if not (i == (DIM - 1) and j == (DIM - 1)):
                f.write(", ")
    f.write(");")