# Employee Profile Management System — C backend
#
#   make            build build/epms-server
#   make run        build, then run with the values in ../config/.env
#   make debug      build with sanitizers
#   make clean

CC      ?= gcc
CFLAGS  ?= -std=c11 -Wall -Wextra -Wpedantic -O2 -D_GNU_SOURCE -Iinclude
LDFLAGS ?= -pthread

SOURCES := $(wildcard src/*.c) $(wildcard routes/*.c) $(wildcard auth/*.c) \
           $(wildcard database/*.c) $(wildcard utils/*.c)
OBJECTS := $(SOURCES:%.c=build/%.o)
TARGET  := build/epms-server

.PHONY: all run debug clean

all: $(TARGET)

$(TARGET): $(OBJECTS)
	@mkdir -p $(dir $@)
	$(CC) $(OBJECTS) -o $@ $(LDFLAGS)
	@echo "built $@"

build/%.o: %.c
	@mkdir -p $(dir $@)
	$(CC) $(CFLAGS) -c $< -o $@

debug: CFLAGS += -g -O0 -fsanitize=address,undefined
debug: LDFLAGS += -fsanitize=address,undefined
debug: clean $(TARGET)

run: $(TARGET)
	@set -a; [ -f ../config/.env ] && . ../config/.env; set +a; ./$(TARGET)

clean:
	rm -rf build

# PostgreSQL build (after database/db.c is ported to libpq):
#   make CFLAGS="$(CFLAGS) -DUSE_POSTGRES $$(pkg-config --cflags libpq)" \
#        LDFLAGS="$(LDFLAGS) $$(pkg-config --libs libpq)"
